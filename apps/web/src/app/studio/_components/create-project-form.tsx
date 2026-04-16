"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

import { createProjectImport, runStudioPrep } from "@/lib/api";
import { cacheProject } from "@/lib/project-cache";

export function CreateProjectForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const sourceType = String(form.get("source_type") ?? "upload");
    const upload = form.get("file");
    const hasUpload = upload instanceof File && upload.size > 0;
    const shouldAutoPrep = sourceType !== "upload" || hasUpload;

    try {
      const response = await createProjectImport(form);
      let latestProject = response.project;
      if (shouldAutoPrep) {
        try {
          const prepResponse = await runStudioPrep(response.project.id);
          latestProject = prepResponse.project;
        } catch {
          // Keep the UX moving even if hosted prep fails; the workspace can recover.
        }
      }
      cacheProject(latestProject);
      startTransition(() => {
        router.push(`/studio/${latestProject.id}`);
      });
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Could not create the project.",
      );
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="inventory-card rounded-[1.75rem] p-6 sm:p-7">
      <div className="mb-6">
        <p className="eyebrow">Create Project</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
          Start from an upload, prompt, or reference.
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-7 text-stone-700">
          Create a project and jump into the studio. Uploads go straight into editing prep, while
          prompt and reference projects can be used to kick off idea generation.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm text-stone-700">
          Project name
          <input
            required
            name="name"
            placeholder="Night Drive Remix"
            className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-stone-900"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm text-stone-700">
          Source type
          <select
            name="source_type"
            defaultValue="upload"
            className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-stone-900"
          >
            <option value="upload">Audio upload</option>
            <option value="reference">Reference session</option>
            <option value="prompt">Prompt-led idea</option>
          </select>
        </label>
      </div>

      <label className="mt-4 flex flex-col gap-2 text-sm text-stone-700">
        Audio file
        <input
          name="file"
          type="file"
          accept="audio/*"
          className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-4 text-sm"
        />
      </label>

      <label className="mt-4 flex flex-col gap-2 text-sm text-stone-700">
        Prompt text
        <textarea
          name="prompt_text"
          placeholder="Write a moody synth-pop verse with a soaring chorus and soft female vocals."
          rows={4}
          className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-stone-900"
        />
      </label>

      <label className="mt-4 flex flex-col gap-2 text-sm text-stone-700">
        Reference URL
        <input
          name="reference_url"
          type="url"
          placeholder="https://example.com/reference-track"
          className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-stone-900"
        />
      </label>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
        >
          {isSubmitting ? "Creating studio..." : "Create project"}
        </button>
        <p className="max-w-xl text-sm leading-7 text-stone-600">
          Uploads move into audio prep right away. Prompt and reference projects can use
          generation features when those services are configured.
        </p>
      </div>

      {error ? (
        <p className="mt-4 rounded-2xl bg-amber-100 px-4 py-3 text-sm text-amber-900">
          {error}
        </p>
      ) : null}
    </form>
  );
}
