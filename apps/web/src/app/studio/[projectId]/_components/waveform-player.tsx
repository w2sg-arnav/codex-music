"use client";

import { useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";

import { resolveApiUrl } from "@/lib/api";

export function WaveformPlayer({
  audioPath,
  title = "Waveform",
  description = "Playback uses wavesurfer.js on top of the uploaded project audio.",
  readyLabel = "Previewing project audio",
  emptyLabel = "No audio is available for this player yet.",
  allowSpectrogram = false,
  compact = false,
}: {
  audioPath: string | null;
  title?: string;
  description?: string;
  readyLabel?: string;
  emptyLabel?: string;
  allowSpectrogram?: boolean;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const spectrogramContainerRef = useRef<HTMLDivElement | null>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"waveform" | "spectrogram">("waveform");
  const audioUrl = resolveApiUrl(audioPath);

  useEffect(() => {
    if (!audioUrl || !containerRef.current) {
      return;
    }

    let destroyed = false;
    const resolvedUrl = audioUrl;

    async function mount() {
      try {
        setError(null);
        setIsReady(false);
        setIsPlaying(false);
        const WaveSurfer = (await import("wavesurfer.js")).default;
        if (!containerRef.current || destroyed || !resolvedUrl) {
          return;
        }

        const plugins = [];
        if (allowSpectrogram && viewMode === "spectrogram" && spectrogramContainerRef.current) {
          const Spectrogram = (
            await import("wavesurfer.js/dist/plugins/spectrogram.esm.js")
          ).default;
          plugins.push(
            Spectrogram.create({
              container: spectrogramContainerRef.current,
              labels: true,
              height: compact ? 120 : 160,
              scale: "mel",
              colorMap: "roseus",
            }),
          );
        }

        const instance = WaveSurfer.create({
          container: containerRef.current,
          url: resolvedUrl,
          waveColor: "#c6d0da",
          progressColor: "#0f9d7a",
          cursorColor: "#11151a",
          barWidth: 2,
          barGap: 2,
          barRadius: 3,
          height: compact ? 72 : 96,
          plugins,
        });
        waveSurferRef.current = instance;

        instance.on("ready", () => {
          if (!destroyed) {
            setIsReady(true);
          }
        });
        instance.on("play", () => {
          if (!destroyed) {
            setIsPlaying(true);
          }
        });
        instance.on("pause", () => {
          if (!destroyed) {
            setIsPlaying(false);
          }
        });
      } catch (mountError) {
        setError(
          mountError instanceof Error
            ? mountError.message
            : "Could not render waveform.",
        );
      }
    }

    void mount();

    return () => {
      destroyed = true;
      waveSurferRef.current?.destroy();
      waveSurferRef.current = null;
    };
  }, [allowSpectrogram, audioUrl, compact, viewMode]);

  if (!audioUrl) {
    return (
      <div className="rounded-[1.5rem] border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-sm text-stone-600">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="glass-card rounded-[1.5rem] p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow">{title}</p>
          <p className="mt-2 text-sm text-stone-700">
            {isReady ? readyLabel : "Loading waveform..."}
          </p>
        </div>
        <button
          type="button"
          disabled={!isReady}
          onClick={() => {
            waveSurferRef.current?.playPause();
          }}
          className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 transition hover:border-stone-900 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
      </div>

      {allowSpectrogram ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setViewMode("waveform");
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              viewMode === "waveform"
                ? "bg-stone-950 text-stone-50"
                : "border border-stone-300 text-stone-800 hover:border-stone-900 hover:bg-stone-100"
            }`}
          >
            Waveform
          </button>
          <button
            type="button"
            onClick={() => {
              setViewMode("spectrogram");
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              viewMode === "spectrogram"
                ? "bg-stone-950 text-stone-50"
                : "border border-stone-300 text-stone-800 hover:border-stone-900 hover:bg-stone-100"
            }`}
          >
            Spectrogram
          </button>
        </div>
      ) : null}

      <div ref={containerRef} className="min-h-24" />
      {allowSpectrogram && viewMode === "spectrogram" ? (
        <div
          ref={spectrogramContainerRef}
          className="mt-3 overflow-hidden rounded-[1rem] border border-stone-200 bg-stone-950/90"
        />
      ) : null}

      <audio controls src={audioUrl} className="mt-4 w-full" />

      {error ? (
        <p className="mt-3 text-sm text-amber-900">{error}</p>
      ) : (
        <p className="mt-3 text-sm text-stone-600">{description}</p>
      )}
    </div>
  );
}
