from __future__ import annotations

from dataclasses import dataclass
from math import gcd
from typing import TYPE_CHECKING, Any, Literal, cast

import numpy as np
import soundfile as sf  # type: ignore[import-untyped]
from scipy import signal  # type: ignore[import-untyped]

if TYPE_CHECKING:
    from pathlib import Path

NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    dtype=float,
)
MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
    dtype=float,
)
TARGET_SAMPLE_RATE = 22_050
FRAME_SIZE = 2_048
HOP_LENGTH = 512
MIN_BPM = 70.0
MAX_BPM = 180.0


@dataclass(slots=True)
class DetectedSection:
    """One coarse section estimate from the current source."""

    label: str
    start_bar: int
    end_bar: int
    energy: Literal["low", "medium", "high"]
    summary: str


@dataclass(slots=True)
class AudioAnalysisSummary:
    """Computed musical features for one audio source."""

    bpm: float
    musical_key: str
    chord_progression: list[str]
    arrangement_notes: list[str]
    sections: list[DetectedSection]
    duration_seconds: float
    midi_ready: bool
    key_confidence: float
    transient_strength: float


def analyze_audio_file(audio_path: Path) -> AudioAnalysisSummary:
    """Analyze one audio file and return tempo, key, chords, and arrangement notes."""

    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file does not exist: {audio_path}")

    signal_mono, sample_rate = _load_audio_mono(audio_path)
    if signal_mono.size == 0:
        raise ValueError("Audio analysis received an empty signal")

    frequencies, magnitude = _compute_stft(signal_mono, sample_rate)
    onset_envelope = _compute_onset_envelope(magnitude)
    bpm = _estimate_bpm(onset_envelope, sample_rate)
    beat_frames = _estimate_beat_frames(onset_envelope, sample_rate, magnitude.shape[1], bpm)
    chroma = _compute_chroma(magnitude, frequencies)
    musical_key, key_confidence = _estimate_key(chroma)
    chord_progression = _estimate_chord_progression(chroma, beat_frames)
    transient_strength = _transient_strength(onset_envelope)
    arrangement_notes = _build_arrangement_notes(
        waveform=signal_mono,
        magnitude=magnitude,
        frequencies=frequencies,
        bpm=bpm,
        key_confidence=key_confidence,
        transient_strength=transient_strength,
    )
    sections = _estimate_sections(signal_mono, bpm)
    midi_ready = _estimate_midi_ready(onset_envelope, chroma)

    return AudioAnalysisSummary(
        bpm=bpm,
        musical_key=musical_key,
        chord_progression=chord_progression,
        arrangement_notes=arrangement_notes,
        sections=sections,
        duration_seconds=round(signal_mono.size / sample_rate, 2),
        midi_ready=midi_ready,
        key_confidence=key_confidence,
        transient_strength=transient_strength,
    )


def _load_audio_mono(audio_path: Path) -> tuple[np.ndarray[Any, Any], int]:
    """Load one file, downmix it to mono, and resample to the target rate."""

    audio, sample_rate = sf.read(str(audio_path), dtype="float32", always_2d=True)
    mono = np.mean(np.asarray(audio, dtype=float), axis=1)
    if mono.size == 0:
        return np.asarray([], dtype=float), TARGET_SAMPLE_RATE

    peak = float(np.max(np.abs(mono)))
    if peak > 0:
        mono = mono / peak

    if int(sample_rate) == TARGET_SAMPLE_RATE:
        return np.asarray(mono, dtype=float), TARGET_SAMPLE_RATE

    common_divisor = gcd(int(sample_rate), TARGET_SAMPLE_RATE)
    resampled = signal.resample_poly(
        np.asarray(mono, dtype=float),
        up=TARGET_SAMPLE_RATE // common_divisor,
        down=int(sample_rate) // common_divisor,
    )
    return np.asarray(resampled, dtype=float), TARGET_SAMPLE_RATE


def _compute_stft(
    waveform: np.ndarray[Any, Any],
    sample_rate: int,
) -> tuple[np.ndarray[Any, Any], np.ndarray[Any, Any]]:
    """Return frequency bins and a magnitude spectrogram for one waveform."""

    frequencies, _, complex_spectrum = signal.stft(
        waveform,
        fs=sample_rate,
        window="hann",
        nperseg=FRAME_SIZE,
        noverlap=FRAME_SIZE - HOP_LENGTH,
        boundary=None,
        padded=False,
    )
    return np.asarray(frequencies, dtype=float), np.abs(np.asarray(complex_spectrum, dtype=complex))


def _compute_onset_envelope(magnitude: np.ndarray[Any, Any]) -> np.ndarray[Any, Any]:
    """Build a lightweight onset envelope from positive spectral flux."""

    if magnitude.ndim != 2 or magnitude.shape[1] < 2:
        return np.zeros(1, dtype=float)

    log_magnitude = np.log1p(magnitude)
    positive_flux = np.maximum(np.diff(log_magnitude, axis=1), 0.0)
    onset_envelope = np.concatenate(
        (np.zeros(1, dtype=float), np.mean(positive_flux, axis=0)),
    )
    return np.asarray(_normalize_vector(onset_envelope), dtype=float)


def _estimate_bpm(onset_envelope: np.ndarray[Any, Any], sample_rate: int) -> float:
    """Estimate one tempo value from the onset envelope."""

    frame_rate = sample_rate / HOP_LENGTH
    peaks, _ = signal.find_peaks(
        onset_envelope,
        height=max(float(np.percentile(onset_envelope, 75)), 0.05),
        distance=max(1, int(frame_rate * 60.0 / MAX_BPM * 0.5)),
    )
    if peaks.size >= 2:
        intervals = np.diff(peaks) / frame_rate
        valid_intervals = intervals[(intervals > 0.2) & (intervals < 2.0)]
        if valid_intervals.size > 0:
            return _normalize_bpm(60.0 / float(np.median(valid_intervals)))

    centered = onset_envelope - float(np.mean(onset_envelope))
    autocorrelation = signal.correlate(centered, centered, mode="full")
    positive_lags = autocorrelation[autocorrelation.size // 2 :]
    minimum_lag = max(1, int(frame_rate * 60.0 / MAX_BPM))
    maximum_lag = min(positive_lags.size - 1, int(frame_rate * 60.0 / MIN_BPM))
    if maximum_lag <= minimum_lag:
        return 120.0

    lag_window = positive_lags[minimum_lag : maximum_lag + 1]
    best_lag = minimum_lag + int(np.argmax(lag_window))
    if best_lag <= 0:
        return 120.0
    return _normalize_bpm(60.0 * frame_rate / best_lag)


def _normalize_bpm(bpm: float) -> float:
    """Fold one BPM estimate into the expected musical range."""

    normalized = float(bpm)
    while normalized < MIN_BPM:
        normalized *= 2.0
    while normalized > MAX_BPM:
        normalized /= 2.0
    return round(max(MIN_BPM, min(MAX_BPM, normalized)), 1)


def _estimate_beat_frames(
    onset_envelope: np.ndarray[Any, Any],
    sample_rate: int,
    frame_count: int,
    bpm: float,
) -> np.ndarray[Any, Any]:
    """Return coarse beat boundaries for chord segmentation."""

    peaks, _ = signal.find_peaks(
        onset_envelope,
        height=max(float(np.percentile(onset_envelope, 70)), 0.04),
        distance=max(1, int(sample_rate * 60.0 / bpm / HOP_LENGTH * 0.5)),
    )
    if peaks.size >= 2:
        return np.asarray(peaks, dtype=int)

    frames_per_beat = max(1, int(round(sample_rate * 60.0 / bpm / HOP_LENGTH)))
    return np.arange(0, frame_count, frames_per_beat, dtype=int)


def _compute_chroma(
    magnitude: np.ndarray[Any, Any],
    frequencies: np.ndarray[Any, Any],
) -> np.ndarray[Any, Any]:
    """Project the magnitude spectrogram onto 12 pitch classes."""

    if magnitude.ndim != 2 or magnitude.shape[1] == 0:
        return np.zeros((12, 1), dtype=float)

    valid_mask = frequencies >= 27.5
    if not np.any(valid_mask):
        return np.zeros((12, magnitude.shape[1]), dtype=float)

    selected_frequencies = frequencies[valid_mask]
    selected_magnitude = magnitude[valid_mask]
    midi_numbers = np.rint(69 + 12 * np.log2(selected_frequencies / 440.0)).astype(int)
    pitch_classes = np.mod(midi_numbers, 12)

    chroma = np.zeros((12, magnitude.shape[1]), dtype=float)
    for pitch_class in range(12):
        class_mask = pitch_classes == pitch_class
        if not np.any(class_mask):
            continue
        chroma[pitch_class] = np.sum(selected_magnitude[class_mask], axis=0)

    frame_energy = np.sum(chroma, axis=0, keepdims=True)
    frame_energy[frame_energy == 0] = 1.0
    return cast("np.ndarray[Any, Any]", chroma / frame_energy)


def _estimate_key(chroma: np.ndarray[Any, Any]) -> tuple[str, float]:
    """Estimate a major or minor key from the mean chroma profile."""

    chroma_mean = np.asarray(np.mean(chroma, axis=1), dtype=float)
    if chroma_mean.size != 12 or float(np.sum(chroma_mean)) <= 0:
        return "C major", 0.0

    normalized_chroma = chroma_mean / np.sum(chroma_mean)
    normalized_major = MAJOR_PROFILE / np.sum(MAJOR_PROFILE)
    normalized_minor = MINOR_PROFILE / np.sum(MINOR_PROFILE)

    best_root = 0
    best_mode = "major"
    best_score = -1.0

    for root in range(12):
        major_score = _cosine_similarity(normalized_chroma, np.roll(normalized_major, root))
        if major_score > best_score:
            best_root = root
            best_mode = "major"
            best_score = major_score

        minor_score = _cosine_similarity(normalized_chroma, np.roll(normalized_minor, root))
        if minor_score > best_score:
            best_root = root
            best_mode = "minor"
            best_score = minor_score

    confidence = max(0.0, min(1.0, (best_score + 1.0) / 2.0))
    return f"{NOTE_NAMES[best_root]} {best_mode}", round(confidence, 2)


def _cosine_similarity(left: np.ndarray[Any, Any], right: np.ndarray[Any, Any]) -> float:
    """Return cosine similarity between two one-dimensional vectors."""

    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    if denominator <= 0:
        return 0.0
    return float(np.dot(left, right) / denominator)


def _estimate_chord_progression(
    chroma: np.ndarray[Any, Any],
    beat_frames: np.ndarray[Any, Any],
) -> list[str]:
    """Estimate a coarse chord progression from beat-synchronous chroma segments."""

    frame_count = int(chroma.shape[1]) if chroma.ndim == 2 else 0
    if frame_count == 0:
        return []

    beat_array = np.asarray(beat_frames, dtype=int)
    if beat_array.size < 2:
        boundaries = np.linspace(0, frame_count, num=min(6, frame_count + 1), dtype=int)
    else:
        boundaries = np.concatenate(
            (np.array([0], dtype=int), beat_array, np.array([frame_count], dtype=int))
        )
        boundaries = np.unique(np.clip(boundaries, 0, frame_count))

    progression: list[str] = []
    previous_label: str | None = None
    for start, end in zip(boundaries[:-1], boundaries[1:], strict=False):
        if int(end) <= int(start):
            continue
        segment = chroma[:, int(start) : int(end)]
        label = _best_chord_label(np.mean(segment, axis=1))
        if label is None or label == previous_label:
            continue
        progression.append(label)
        previous_label = label
        if len(progression) >= 4:
            break

    if progression:
        return progression

    fallback_label = _best_chord_label(np.mean(chroma, axis=1))
    return [fallback_label] if fallback_label else []


def _best_chord_label(chroma_vector: np.ndarray[Any, Any]) -> str | None:
    """Select the best-fitting major or minor triad for one chroma vector."""

    vector = np.asarray(chroma_vector, dtype=float)
    if vector.size != 12 or float(np.sum(vector)) <= 0:
        return None

    normalized = vector / np.sum(vector)
    best_label: str | None = None
    best_score = -1.0

    for root, note_name in enumerate(NOTE_NAMES):
        major_template = np.zeros(12, dtype=float)
        major_template[[root, (root + 4) % 12, (root + 7) % 12]] = 1.0
        major_score = _cosine_similarity(normalized, major_template / np.sum(major_template))
        if major_score > best_score:
            best_score = major_score
            best_label = note_name

        minor_template = np.zeros(12, dtype=float)
        minor_template[[root, (root + 3) % 12, (root + 7) % 12]] = 1.0
        minor_score = _cosine_similarity(normalized, minor_template / np.sum(minor_template))
        if minor_score > best_score:
            best_score = minor_score
            best_label = f"{note_name}m"

    return best_label


def _transient_strength(onset_envelope: np.ndarray[Any, Any]) -> float:
    """Return one normalized transient-strength summary."""

    if onset_envelope.size == 0:
        return 0.0
    return round(float(np.percentile(onset_envelope, 90)), 3)


def _estimate_midi_ready(
    onset_envelope: np.ndarray[Any, Any],
    chroma: np.ndarray[Any, Any],
) -> bool:
    """Decide whether the current source looks structured enough for MIDI extraction."""

    peaks, _ = signal.find_peaks(
        onset_envelope,
        height=max(float(np.percentile(onset_envelope, 70)), 0.04),
        distance=2,
    )
    active_pitch_classes = int(np.count_nonzero(np.mean(chroma, axis=1) > 0.06))
    return bool(peaks.size >= 4 and active_pitch_classes >= 3)


def _build_arrangement_notes(
    *,
    waveform: np.ndarray[Any, Any],
    magnitude: np.ndarray[Any, Any],
    frequencies: np.ndarray[Any, Any],
    bpm: float,
    key_confidence: float,
    transient_strength: float,
) -> list[str]:
    """Create human-readable arrangement notes from computed features."""

    notes: list[str] = []
    rms = _frame_rms(waveform)
    energy_chunks = [
        float(np.mean(chunk)) if chunk.size > 0 else 0.0
        for chunk in np.array_split(rms, 3)
    ]
    if energy_chunks:
        peak_chunk = int(np.argmax(energy_chunks))
        if peak_chunk == 1:
            notes.append("Middle section carries the strongest energy and feels chorus-like.")
        elif peak_chunk == 2:
            notes.append("Later section lifts hardest and could support an extended finale.")
        else:
            notes.append("Opening section hits early, so preserve impact when editing the intro.")

        if energy_chunks[0] < max(energy_chunks) * 0.8:
            notes.append("Intro energy is lower than the peak, which leaves room for a lift edit.")

    centroid = _spectral_centroid(magnitude, frequencies)
    centroid_chunks = [
        float(np.mean(chunk)) if chunk.size > 0 else 0.0
        for chunk in np.array_split(centroid, 3)
    ]
    if centroid_chunks:
        if centroid_chunks[-1] > centroid_chunks[0] * 1.15:
            notes.append("Top-end brightness increases later, so the outro can handle more air.")
        elif centroid_chunks[0] > centroid_chunks[-1] * 1.15:
            notes.append("Front-loaded brightness suggests taming the intro before extending it.")

    if bpm >= 128:
        notes.append("Tempo is energetic enough for remix or loop-based editing moves.")
    elif bpm <= 92:
        notes.append("Tempo is relaxed, so time-stretch edits should stay gentle.")

    if key_confidence < 0.58:
        notes.append("Harmonic center is ambiguous, so chord edits should be reviewed by ear.")
    else:
        notes.append("Detected key center is stable enough to drive pitch-aware edit suggestions.")

    if transient_strength >= 0.18:
        notes.append(
            "Transient detail is pronounced, which improves timing edits and MIDI extraction."
        )
    else:
        notes.append(
            "Transient detail is soft, so MIDI extraction may work best on separated stems."
        )

    return notes[:4]


def _estimate_sections(
    waveform: np.ndarray[Any, Any],
    bpm: float,
) -> list[DetectedSection]:
    """Build a coarse intro/verse/chorus-style map from energy chunks."""

    rms = _frame_rms(waveform)
    if rms.size == 0:
        return []

    chunk_count = 4 if rms.size >= 24 else 3
    chunk_labels = (
        ["Intro", "Verse", "Chorus", "Outro"]
        if chunk_count == 4
        else ["Intro", "Main", "Lift"]
    )
    energy_bands = np.array_split(rms, chunk_count)
    total_beats = max(4, int(round((waveform.size / TARGET_SAMPLE_RATE) * bpm / 60.0)))
    total_bars = max(1, int(np.ceil(total_beats / 4)))
    bar_edges = np.linspace(1, total_bars + 1, num=chunk_count + 1, dtype=int)
    peak_energy = max(float(np.max(rms)), 1e-6)
    sections: list[DetectedSection] = []

    for index, chunk in enumerate(energy_bands):
        if chunk.size == 0:
            continue
        average_energy = float(np.mean(chunk))
        energy: Literal["low", "medium", "high"]
        if average_energy >= peak_energy * 0.75:
            energy = "high"
            summary = "Peak energy section suited to hooks, drops, or the densest arrangement move."
        elif average_energy >= peak_energy * 0.45:
            energy = "medium"
            summary = (
                "Balanced section that can carry the main groove without "
                "overwhelming transitions."
            )
        else:
            energy = "low"
            summary = (
                "Lower-energy section that leaves room for buildup, lyric focus, "
                "or negative space."
            )

        start_bar = int(bar_edges[index])
        end_bar = max(start_bar, int(bar_edges[index + 1]) - 1)
        sections.append(
            DetectedSection(
                label=chunk_labels[index] if index < len(chunk_labels) else f"Section {index + 1}",
                start_bar=start_bar,
                end_bar=end_bar,
                energy=energy,
                summary=summary,
            )
        )

    return sections


def _frame_rms(waveform: np.ndarray[Any, Any]) -> np.ndarray[Any, Any]:
    """Return a frame-wise RMS energy curve."""

    if waveform.size < FRAME_SIZE:
        return np.asarray([float(np.sqrt(np.mean(np.square(waveform))))], dtype=float)

    frame_count = 1 + max(0, (waveform.size - FRAME_SIZE) // HOP_LENGTH)
    if frame_count <= 0:
        return np.asarray([0.0], dtype=float)

    frames = np.empty((frame_count, FRAME_SIZE), dtype=float)
    for frame_index in range(frame_count):
        start = frame_index * HOP_LENGTH
        frames[frame_index] = waveform[start : start + FRAME_SIZE]
    return cast("np.ndarray[Any, Any]", np.sqrt(np.mean(np.square(frames), axis=1)))


def _spectral_centroid(
    magnitude: np.ndarray[Any, Any],
    frequencies: np.ndarray[Any, Any],
) -> np.ndarray[Any, Any]:
    """Return the spectral centroid for each time frame."""

    if magnitude.ndim != 2 or magnitude.shape[1] == 0:
        return np.asarray([0.0], dtype=float)

    numerator = np.sum(frequencies[:, None] * magnitude, axis=0)
    denominator = np.sum(magnitude, axis=0)
    denominator[denominator == 0] = 1.0
    return cast("np.ndarray[Any, Any]", numerator / denominator)


def _normalize_vector(values: np.ndarray[Any, Any]) -> np.ndarray[Any, Any]:
    """Scale one vector into the unit interval."""

    minimum = float(np.min(values))
    maximum = float(np.max(values))
    if maximum <= minimum:
        return np.zeros_like(values, dtype=float)
    return cast("np.ndarray[Any, Any]", (values - minimum) / (maximum - minimum))
