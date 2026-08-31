import type {
  LedgerEntry,
  LodgingQuality,
  ReiseLedger,
  ReiseMode,
  SlotHardness,
  SlotSource,
} from './types';
import { EMPTY_LEDGER } from './types';

export function entry<T>(
  value: T,
  source: SlotSource,
  hardness: SlotHardness = source === 'user' ? 'must' : 'inferred',
): LedgerEntry<T> {
  return { value, source, hardness };
}

function rank(src: SlotSource): number {
  if (src === 'user') return 3;
  if (src === 'profile') return 2;
  if (src === 'inferred') return 1;
  return 0;
}

export function mergeEntry<T>(
  prev: LedgerEntry<T> | null,
  next: LedgerEntry<T> | null,
): LedgerEntry<T> | null {
  if (!next) return prev;
  if (!prev) return next;
  if (rank(next.source) >= rank(prev.source)) return next;
  return prev;
}

export function mergeLedger(prev: ReiseLedger, patch: Partial<ReiseLedger>): ReiseLedger {
  const out: ReiseLedger = { ...prev };
  (Object.keys(patch) as Array<keyof ReiseLedger>).forEach((key) => {
    const n = patch[key];
    if (n === undefined) return;
    if (key === 'mustHaves' || key === 'wishHaves' || key === 'hardNos' || key === 'niceHaves') {
      const prevArr = prev[key];
      const nextArr = n as ReiseLedger['mustHaves'];
      if (!nextArr) {
        (out as ReiseLedger)[key] = prevArr;
        return;
      }
      const ids = [...new Set([...(prevArr?.value ?? []), ...nextArr.value])];
      (out as ReiseLedger)[key] = {
        value: ids,
        source: nextArr.source,
        hardness: key === 'mustHaves' || key === 'hardNos' ? 'must' : key === 'niceHaves' ? 'optional' : 'wish',
      };
      return;
    }
    if (key === 'lodgingKind') {
      const nextKind = n as ReiseLedger['lodgingKind'];
      const prevKind = prev.lodgingKind;
      if (
        nextKind?.value === 'hotel' &&
        prevKind?.value &&
        prevKind.value !== 'hotel' &&
        nextKind.hardness !== 'must'
      ) {
        out.lodgingFallback = entry('hotel', 'user', 'wish');
        return;
      }
    }
    if (key === 'dateFlex') {
      const prevFlex = prev.dateFlex;
      const nextFlex = n as ReiseLedger['dateFlex'];
      if (nextFlex?.value === 'exact') {
        out.dateFlex = nextFlex;
        return;
      }
      if (prevFlex?.value === 'weekend' && nextFlex?.value === 'month') {
        out.dateFlex = prevFlex;
        return;
      }
      if (prevFlex?.value === 'exact' && nextFlex && nextFlex.value !== 'exact') {
        out.dateFlex = prevFlex;
        return;
      }
    }
    (out as Record<string, unknown>)[key] = mergeEntry(
      prev[key] as LedgerEntry<unknown> | null,
      n as LedgerEntry<unknown> | null,
    );
  });
  const nos = new Set(out.hardNos?.value ?? []);
  if (nos.size) {
    const strip = (arr: ReiseLedger['mustHaves']) => {
      if (!arr) return arr;
      const nextIds = arr.value.filter((id) => !nos.has(id));
      return nextIds.length ? { ...arr, value: nextIds } : null;
    };
    out.mustHaves = strip(out.mustHaves);
    out.wishHaves = strip(out.wishHaves);
    out.niceHaves = strip(out.niceHaves);
  }
  if (out.lodgingKind?.value && out.lodgingFallback?.value === out.lodgingKind.value) {
    out.lodgingFallback = null;
  }
  const stayKind = out.lodgingKind?.value;
  if (stayKind && stayKind !== 'camping') {
    const dropCamp = (arr: ReiseLedger['mustHaves']) => {
      if (!arr) return arr;
      const nextIds = arr.value.filter((id) => id !== 'camping');
      return nextIds.length ? { ...arr, value: nextIds } : null;
    };
    out.mustHaves = dropCamp(out.mustHaves);
    out.wishHaves = dropCamp(out.wishHaves);
    out.niceHaves = dropCamp(out.niceHaves);
  }
  return deriveLodging(out);
}

function deriveLodging(ledger: ReiseLedger): ReiseLedger {
  const energy = ledger.energy?.value;
  let quality: LodgingQuality = ledger.lodgingQuality?.value ?? null;
  if (!quality && energy === 'chill_pool') quality = 'nicer_base';
  if (!quality && energy === 'active_out') quality = 'cheap_box';
  if (quality && !ledger.lodgingQuality) {
    return { ...ledger, lodgingQuality: entry(quality, 'inferred') };
  }
  return ledger;
}

export function modeUsesAirport(mode: ReiseMode | null | undefined): boolean {
  return mode === 'fly';
}

export function isAirportVisible(ledger: ReiseLedger): boolean {
  return modeUsesAirport(ledger.mode?.value ?? null);
}

/** Unpassende Slots deaktivieren (Wert bleibt), z. B. Airport wenn Auto. */
export function deactivateUnmatchedSlots(ledger: ReiseLedger): ReiseLedger {
  if (isAirportVisible(ledger)) return ledger;
  if (!ledger.airportIata) return ledger;
  return { ...ledger, airportIata: null };
}

export function filledSlotKeys(ledger: ReiseLedger): string[] {
  return (Object.keys(ledger) as Array<keyof ReiseLedger>).filter((k) => ledger[k] != null);
}

export function cloneEmptyLedger(): ReiseLedger {
  return { ...EMPTY_LEDGER };
}
