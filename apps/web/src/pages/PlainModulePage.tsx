import { PageHeader } from "./PageHeader";

interface PlainModulePageProps {
  title: string;
  description: string;
}

export function PlainModulePage({ title, description }: PlainModulePageProps) {
  return (
    <section>
      <PageHeader title={title} description={description} />
      <div className="rounded-md border border-line bg-panel p-5">
        <div className="grid min-h-64 place-items-center border border-dashed border-line px-4 text-center text-sm text-muted">
          Stage 1 module scaffold. Data forms and service methods will be added behind this route.
        </div>
      </div>
    </section>
  );
}
