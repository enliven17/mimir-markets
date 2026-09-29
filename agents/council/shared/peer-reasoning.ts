/**
 * Council-to-council reads, in process.
 *
 * In the source build a persona BOUGHT other personas' reasoning over x402
 * before deciding. Here the council runs in one process and reads are free,
 * so the board simply collects each persona's explanation as it is made in a
 * cycle, and a later persona on the same claim can read a few of them.
 *
 * Off by default (COUNCIL_PEER_READS=1 turns it on): reading peers makes the
 * council's forecasts less independent, which blunts /calibration.
 */

export interface PeerRead {
  slug: string;
  displayName: string;
  text: string;
}

export class PeerBoard {
  private readonly reads = new Map<string, PeerRead[]>();

  record(claimKey: string, read: PeerRead): void {
    const list = this.reads.get(claimKey) ?? [];
    if (list.some((r) => r.slug === read.slug)) return;
    list.push({ ...read, text: read.text.slice(0, 360) });
    this.reads.set(claimKey, list);
  }

  /**
   * Up to `count` peers' reads for `buyer` on one claim, never its own. The
   * starting point rotates with the claim so the same peer isn't always read.
   */
  readsFor(claimKey: string, buyerSlug: string, count: number, rotation = 0): string[] {
    if (count <= 0) return [];
    const peers = (this.reads.get(claimKey) ?? []).filter((r) => r.slug !== buyerSlug);
    if (peers.length === 0) return [];
    const offset = rotation % peers.length;
    const rotated = [...peers.slice(offset), ...peers.slice(0, offset)];
    return rotated.slice(0, count).map((r) => `${r.displayName}: ${r.text}`);
  }

  clear(): void {
    this.reads.clear();
  }
}
