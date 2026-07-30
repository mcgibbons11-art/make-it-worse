"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createRepository } from "@/lib/repository/createRepository";
import type {
  CustomMapDetail,
  CustomMapReportReason,
  CustomMapSort,
  CustomMapSummary,
} from "@/lib/game/community-maps";
import { CHALLENGE_LINK_PARAM } from "@/lib/game/challenge-link";

const REPORT_REASONS: readonly { value: CustomMapReportReason; label: string }[] = [
  { value: "broken", label: "Broken or impossible" },
  { value: "unsafe", label: "Unsafe content" },
  { value: "harassment", label: "Harassment" },
  { value: "hate", label: "Hate speech" },
  { value: "sexual", label: "Sexual content" },
  { value: "personal_information", label: "Personal information" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Something else" },
] as const;

function playUrl(detail: CustomMapDetail): string {
  const params = new URLSearchParams({
    [CHALLENGE_LINK_PARAM]: detail.code,
    map: detail.id,
    version: detail.currentVersion.id,
  });
  return `/c/${detail.currentVersion.challengeSlug}?${params}`;
}

export function CommunityMapsBrowser() {
  const router = useRouter();
  const repository = useMemo(() => createRepository(), []);
  const available = Boolean(repository.listCustomMaps && repository.getCustomMap);
  const [items, setItems] = useState<CustomMapSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [sort, setSort] = useState<CustomMapSort>("trending");
  const [mine, setMine] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reporting, setReporting] = useState<CustomMapSummary | null>(null);
  const [reportReason, setReportReason] = useState<CustomMapReportReason>("broken");
  const [reportNote, setReportNote] = useState("");
  const [managing, setManaging] = useState<CustomMapDetail | null>(null);
  const [manageTitle, setManageTitle] = useState("");
  const [manageDescription, setManageDescription] = useState("");
  const [manageVisibility, setManageVisibility] = useState<"public" | "unlisted" | "private">("public");

  const load = useCallback(async (appendCursor: string | null = null) => {
    if (!repository.listCustomMaps) return;
    setLoading(true);
    setError("");
    try {
      const result = await repository.listCustomMaps({
        q: submittedQuery,
        sort,
        limit: 12,
        ...(appendCursor ? { cursor: appendCursor } : {}),
        mine,
      });
      setItems((current) => appendCursor ? [...current, ...result.items] : result.items);
      setCursor(result.nextCursor);
      for (const item of result.items)
        void repository.recordCustomMapEvent?.(item.id, item.currentVersion.id, "impression").catch(() => false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Community maps could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [mine, repository, sort, submittedQuery]);

  useEffect(() => {
    if (!available) return;
    const timer = window.setTimeout(() => void load(null), 0);
    return () => window.clearTimeout(timer);
  }, [available, load]);

  const openMap = async (item: CustomMapSummary) => {
    if (!repository.getCustomMap) return;
    setNotice(`Loading “${item.title}”…`);
    try {
      const detail = await repository.getCustomMap(item.id, item.currentVersion.id);
      router.push(playUrl(detail));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "That version could not be loaded. Try refreshing the browser.");
    }
  };

  const shareMap = async (item: CustomMapSummary) => {
    const url = `${window.location.origin}/maps/${item.id}?version=${item.currentVersion.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice(`Link to “${item.title}” copied.`);
      void repository.recordCustomMapEvent?.(item.id, item.currentVersion.id, "share").catch(() => false);
    } catch {
      setNotice(`Select and copy: ${url}`);
    }
  };

  const likeMap = async (item: CustomMapSummary) => {
    try {
      const recorded = await repository.recordCustomMapEvent?.(item.id, item.currentVersion.id, "like");
      setNotice(recorded ? `Liked “${item.title}”.` : "You already liked this version.");
      if (recorded)
        setItems((current) => current.map((entry) => entry.id === item.id
          ? { ...entry, metrics: { ...entry.metrics, likes: entry.metrics.likes + 1 } }
          : entry));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "That like could not be saved.");
    }
  };

  const openManage = async (item: CustomMapSummary) => {
    if (!repository.getCustomMap) return;
    try {
      const detail = await repository.getCustomMap(item.id);
      setManaging(detail);
      setManageTitle(detail.title);
      setManageDescription(detail.description);
      setManageVisibility(detail.visibility);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Map settings could not be loaded.");
    }
  };

  const saveMetadata = async () => {
    if (!managing || !repository.updateCustomMap) return;
    try {
      const detail = await repository.updateCustomMap(managing.id, {
        title: manageTitle,
        description: manageDescription,
        visibility: manageVisibility,
      });
      setManaging(detail);
      setNotice("Map details saved.");
      void load(null);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Map details could not be saved.");
    }
  };

  const rollback = async (versionId: string) => {
    if (!managing || !repository.rollbackCustomMap) return;
    try {
      const detail = await repository.rollbackCustomMap(managing.id, versionId);
      setManaging(detail);
      setNotice(`Rolled back to version ${detail.currentVersion.number}. Existing version links remain unchanged.`);
      void load(null);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Rollback failed.");
    }
  };

  const moderate = async (status: "active" | "quarantined" | "rejected") => {
    if (!managing || !repository.moderateCustomMap) return;
    try {
      const detail = await repository.moderateCustomMap(managing.id, status, undefined, "Reviewed in map browser");
      setManaging(detail);
      setNotice(`Moderation status changed to ${status}.`);
      void load(null);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Moderation action failed.");
    }
  };

  const submitReport = async () => {
    if (!reporting || !repository.reportCustomMap) return;
    try {
      const recorded = await repository.reportCustomMap(reporting.id, reporting.currentVersion.id, reportReason, reportNote);
      setNotice(recorded ? "Report sent for review." : "You already reported this version.");
      setReporting(null);
      setReportNote("");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "The report could not be sent.");
    }
  };

  if (!available)
    return <section className="community-empty panel"><h2>Global maps are not connected here</h2><p>This local demo has no shared backend. Portals session maps and self-contained codes still work; configure Supabase to enable this cross-player browser.</p></section>;

  return <section className="community-browser" aria-labelledby="community-title">
    <header className="community-heading"><div><div className="eyebrow">PLAYER-BUILT GAMES</div><h1 id="community-title">Community maps</h1><p>Search immutable versions, play them, or manage your own published rooms.</p></div><button className="button secondary" onClick={() => setMine((value) => !value)}>{mine ? "🌍 Browse everyone" : "🗂 My maps"}</button></header>
    <form className="community-search" onSubmit={(event) => { event.preventDefault(); setSubmittedQuery(query.trim()); }}><input aria-label="Search maps" value={query} maxLength={80} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles and descriptions" /><select aria-label="Sort maps" value={sort} onChange={(event) => setSort(event.target.value as CustomMapSort)}><option value="trending">🔥 Trending</option><option value="new">🆕 Newest</option></select><button className="button primary" type="submit">🔎 Search</button></form>
    {error && <p className="inline-error" role="alert">{error} <button onClick={() => void load(null)}>Retry</button></p>}
    <p className="portals-notice" role="status" aria-live="polite">{notice}</p>
    <div className="community-grid" aria-busy={loading}>{items.map((item) => <article className="community-card" key={item.id}><div className="community-card-art"><span>{item.currentVersion.trapCount ? "💥" : "🧱"}</span><b>v{item.currentVersion.number}</b></div><h2>{item.title}</h2><p>{item.description || "No description. Only consequences."}</p><small>by {item.ownerName} · {item.currentVersion.pieceCount} pieces · {item.currentVersion.trapCount} traps</small><div className="community-metrics"><span>▶ {item.metrics.starts}</span><span>✓ {item.metrics.clears}</span><span>♥ {item.metrics.likes}</span></div><div className="community-card-actions"><button className="button primary" onClick={() => void openMap(item)}>▶ Play</button><button onClick={() => void likeMap(item)}>♥ Like</button><button onClick={() => void shareMap(item)}>🔗 Share</button>{item.isOwner || item.canModerate ? <button onClick={() => void openManage(item)}>⚙ Manage</button> : <button onClick={() => setReporting(item)}>⚑ Report</button>}</div></article>)}</div>
    {!loading && items.length === 0 && <p className="community-empty">{mine ? "You have not published a map yet." : "No maps match that search."}</p>}
    {cursor && <button className="button secondary community-more" disabled={loading} onClick={() => void load(cursor)}>{loading ? "Loading…" : "Load more"}</button>}
    {reporting && <div className="modal-backdrop"><section className="panel community-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title"><h2 id="report-title">Report “{reporting.title}”</h2><label>Reason<select value={reportReason} onChange={(event) => setReportReason(event.target.value as CustomMapReportReason)}>{REPORT_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select></label><label>Optional details<textarea maxLength={500} rows={4} value={reportNote} onChange={(event) => setReportNote(event.target.value)} /></label><div><button className="button secondary" onClick={() => setReporting(null)}>Cancel</button><button className="button danger" onClick={() => void submitReport()}>Send report</button></div></section></div>}
    {managing && <div className="modal-backdrop"><section className="panel community-dialog" role="dialog" aria-modal="true" aria-labelledby="manage-title"><h2 id="manage-title">Manage “{managing.title}”</h2>{managing.isOwner && <><label>Title<input maxLength={80} value={manageTitle} onChange={(event) => setManageTitle(event.target.value)} /></label><label>Description<textarea maxLength={280} rows={3} value={manageDescription} onChange={(event) => setManageDescription(event.target.value)} /></label><label>Visibility<select value={manageVisibility} onChange={(event) => setManageVisibility(event.target.value as typeof manageVisibility)}><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select></label><button className="button primary" onClick={() => void saveMetadata()}>Save details</button><h3>Version history</h3><div className="community-versions">{managing.versions.map((version) => <button key={version.id} disabled={version.id === managing.currentVersion.id} onClick={() => void rollback(version.id)}>v{version.number} · {new Date(version.createdAt).toLocaleString()}{version.id === managing.currentVersion.id ? " · current" : " · restore"}</button>)}</div></>}{managing.canModerate && <><h3>Moderation</h3><div className="community-moderation"><button onClick={() => void moderate("active")}>Restore</button><button onClick={() => void moderate("quarantined")}>Quarantine</button><button onClick={() => void moderate("rejected")}>Remove</button></div></>}<button className="button secondary" onClick={() => setManaging(null)}>Close</button></section></div>}
  </section>;
}
