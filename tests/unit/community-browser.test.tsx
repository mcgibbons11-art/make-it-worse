// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  event: vi.fn(),
  update: vi.fn(),
  rollback: vi.fn(),
  report: vi.fn(),
  moderate: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/repository/createRepository", () => ({
  createRepository: () => ({
    mode: "supabase",
    listCustomMaps: mocks.list,
    getCustomMap: mocks.get,
    recordCustomMapEvent: mocks.event,
    updateCustomMap: mocks.update,
    rollbackCustomMap: mocks.rollback,
    reportCustomMap: mocks.report,
    moderateCustomMap: mocks.moderate,
  }),
}));

import { CommunityMapsBrowser } from "@/components/community/CommunityMapsBrowser";

const mapId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const timestamp = "2026-07-30T12:00:00.000Z";
const summary = {
  id: mapId,
  title: "Kitchen Catastrophe",
  description: "Pans everywhere.",
  visibility: "public" as const,
  moderationStatus: "active" as const,
  ownerName: "Sneaky Teapot",
  ownerAvatarSeed: 22,
  currentVersion: { id: versionId, number: 3, schemaVersion: 1 as const, challengeSlug: "clean-000abc", payloadHash: "a".repeat(64), pieceCount: 14, trapCount: 4, playable: true, createdAt: timestamp },
  metrics: { impressions: 9, starts: 7, clears: 3, likes: 2, shares: 1, reports: 0 },
  trendingScore: 12,
  isOwner: false,
  canModerate: false,
  createdAt: timestamp,
  updatedAt: timestamp,
  publishedAt: timestamp,
};
const detail = { ...summary, code: "valid-code", versions: [summary.currentVersion] };

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.list.mockResolvedValue({ items: [summary], nextCursor: null });
  mocks.get.mockResolvedValue(detail);
  mocks.event.mockResolvedValue(true);
  mocks.rollback.mockResolvedValue(detail);
});
afterEach(cleanup);

describe("community map browser", () => {
  it("shows creator/version attribution and loads an exact playable version", async () => {
    render(<CommunityMapsBrowser />);
    expect(await screen.findByRole("heading", { name: "Kitchen Catastrophe" })).toBeInTheDocument();
    expect(screen.getByText(/by Sneaky Teapot · 14 pieces · 4 traps/)).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
    await waitFor(() => expect(mocks.event).toHaveBeenCalledWith(mapId, versionId, "impression"));
    fireEvent.click(screen.getByRole("button", { name: "▶ Play" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining(`map=${mapId}`)));
    expect(mocks.push.mock.calls[0]![0]).toContain(`version=${versionId}`);
    expect(mocks.push.mock.calls[0]![0]).toContain("d=valid-code");
  });

  it("records one like and updates the visible count", async () => {
    render(<CommunityMapsBrowser />);
    await screen.findByRole("heading", { name: "Kitchen Catastrophe" });
    fireEvent.click(screen.getByRole("button", { name: "♥ Like" }));
    await waitFor(() => expect(mocks.event).toHaveBeenCalledWith(mapId, versionId, "like"));
    expect(await screen.findByText("♥ 3")).toBeInTheDocument();
  });

  it("lets an owner inspect history and rollback without mutating old versions", async () => {
    const oldVersion = { ...summary.currentVersion, id: "33333333-3333-4333-8333-333333333333", number: 2, payloadHash: "b".repeat(64) };
    const ownerSummary = { ...summary, isOwner: true };
    const ownerDetail = { ...detail, isOwner: true, versions: [summary.currentVersion, oldVersion] };
    mocks.list.mockResolvedValue({ items: [ownerSummary], nextCursor: null });
    mocks.get.mockResolvedValue(ownerDetail);
    mocks.rollback.mockResolvedValue({ ...ownerDetail, currentVersion: oldVersion });
    render(<CommunityMapsBrowser />);
    await screen.findByRole("heading", { name: "Kitchen Catastrophe" });
    fireEvent.click(screen.getByRole("button", { name: "⚙ Manage" }));
    expect(await screen.findByRole("heading", { name: /Manage “Kitchen Catastrophe”/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /v2 .* restore/ }));
    await waitFor(() => expect(mocks.rollback).toHaveBeenCalledWith(mapId, oldVersion.id));
    expect(await screen.findByText(/Existing version links remain unchanged/)).toBeInTheDocument();
  });
});
