import { render, screen } from "@testing-library/react";
import { OverviewTab } from "./OverviewTab";
import type { WorkforceSync } from "../model/types";

const noop = () => undefined;

describe("OverviewTab", () => {
  it("mostra o estado vazio antes da primeira sincronização", () => {
    render(<OverviewTab latest={null} loading={false} error={null} syncing={false} onRetry={noop} onSynchronize={noop} onFullSync={noop} />);
    expect(screen.getByText("Nenhuma sincronização executada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sincronizar agora" })).toBeEnabled();
  });

  it("explica sucesso parcial e mantém as duas fontes visíveis", () => {
    const sourceBase = {
      status: "succeeded" as const, receivedCount: 1, createdCount: 1, updatedCount: 0, deactivatedCount: 0,
      timeRecordReceivedCount: 2, timeRecordCreatedCount: 2, timeRecordUpdatedCount: 0, timeRecordRemovedCount: 0,
      completeSnapshot: true, coverageFrom: "2026-09-01", coverageTo: "2026-09-20", errorCode: null, errorMessage: null,
      startedAt: "2026-09-20T10:00:00Z", completedAt: "2026-09-20T10:01:00Z",
    };
    const latest: WorkforceSync = {
      id: "batch", status: "partiallySucceeded", startedAt: sourceBase.startedAt, completedAt: sourceBase.completedAt,
      sources: [
        { ...sourceBase, source: "monday" },
        { ...sourceBase, source: "vrMais", status: "failed", errorCode: "vr_unavailable", errorMessage: "VR indisponível" },
      ],
    };
    render(<OverviewTab latest={latest} loading={false} error={null} syncing={false} onRetry={noop} onSynchronize={noop} onFullSync={noop} />);
    expect(screen.getByRole("alert")).toHaveTextContent("terminou parcialmente");
    expect(screen.getByRole("heading", { name: "Monday" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "VR Mais" })).toBeInTheDocument();
    expect(screen.getByText("VR indisponível")).toBeInTheDocument();
  });
});
