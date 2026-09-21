/*
 * Mirrors the JSON contract emitted by `darwin-local-test/departures-daemon.mjs`.
 * Single source of truth for both the React side and (informally) the daemon.
 *
 * Wire path during local dev:
 *   browser  →  http://localhost:3000/api/darwin/*  (Vite proxy)
 *                                  ↓
 *   daemon   ←  http://localhost:4001/api/*
 */

export type DarwinReasonSource =
  | 'schedule'
  | 'schedule-loc'
  | 'ts'
  | 'ts-loc'
  | 'ts-loc-can'
  | 'deactivated';

export interface DarwinReason {
  /** Numeric reason code from the reference XML, when known. */
  code?: string;
  /** Where in the Push Port stream this reason came from. */
  source: DarwinReasonSource;
  /** Human-readable text — already resolved against the reference table. */
  reason: string;
}

export type LiveTimeKind =
  | 'scheduled'    // no live data yet — public scheduled time
  | 'working'      // working timetable time (±30s precision)
  | 'est'          // forecast departure
  | 'actual'       // actual departure (recorded by signalling)
  | 'est-arr'      // forecast arrival (when no departure forecast available)
  | 'actual-arr';  // actual arrival (terminating / set-down only services)

export type DepartureServiceType =
  | 'passenger'
  | 'freight'
  | 'rail-replacement'
  | 'other';

export interface DepartureRow {
  rid: string;
  trainId: string;
  uid: string;
  /** Present when the daemon emits separate arrival rows (`buildDeparturesAndArrivalsForTiplocs`). */
  movement?: 'departure' | 'arrival';

  toc: string;
  tocName: string | null;
  /** Darwin/CIF train category code when provided (e.g. "OO"). */
  trainCat: string | null;
  /** Normalised service type derived from Darwin feed metadata. */
  serviceType: DepartureServiceType;
  /** True when this row is a pass-through point (PP/OPPP), not a calling stop. */
  isPassing?: boolean;

  scheduledTime: string;       // "HH:MM"
  scheduledAt: string;         // ISO8601 anchored to today
  liveTime: string;
  liveKind: LiveTimeKind;
  /** Forecast source code from Darwin TS (e.g. "TD", "CIS"). */
  liveSource?: string | null;
  /** Source instance (e.g. CIS code) when provided. */
  liveSourceInstance?: string | null;
  /** Unknown-delay forecast state (`delayed=true`). */
  unknownDelay?: boolean;
  /** Manual unknown-delay set (`etUnknown=true`). */
  manualUnknownDelay?: boolean;
  /** Positive = late, negative = early, zero = on time. */
  delayMinutes?: number | null;
  /** Train length in coaches at this location when supplied. */
  trainLength?: number | null;

  platform: string | null;     // scheduled
  livePlatform: string | null; // overlaid
  /** Platform source: P=planned, A=automatic, M=manual. */
  platformSource?: string | null;
  /** True when Darwin marks platform as confirmed. */
  platformConfirmed?: boolean;
  /** True when platform is suppressed by CIS/workstation. */
  platformSuppressed?: boolean;

  /**
   * The exact TIPLOC this row was sourced from. For most rows this matches
   * the snapshot's top-level `tiploc`. For multi-platform stations queried
   * by CRS (e.g. STP) this can be different — STPX, STPANCI, STPXBOX all
   * share `crs="STP"` but represent different platform groups.
   */
  sourceTiploc?: string;

  origin: string;              // TIPLOC
  originName: string | null;
  originCrs: string | null;

  destination: string;         // TIPLOC
  destinationName: string | null;
  destinationCrs: string | null;

  callingAfter: string[];               // TIPLOCs after this stop
  callingAfterNames: (string | null)[]; // parallel — null for junctions
  callingAfterCrs:   (string | null)[]; // parallel

  isPassenger: boolean;
  cancelled: boolean;
  cancellation: DarwinReason | null;
  delayReason:  DarwinReason | null;

  /**
   * Live passenger-loading at the queried stop. `loadingPercentage` is a
   * 0–100 figure (when published by the TOC). `coachLoading` is per-coach:
   * Darwin’s 1–10 occupancy grade, or 0–100% on operators such as XR.
   */
  loadingPercentage: number | null;
  coachLoading: CoachLoadingValue[] | null;
  reverseFormation: boolean;
  hasConsist: boolean;
  /** True when Darwin published `scheduleFormations` for this RID (coach classes / layout). */
  hasFormation?: boolean;
  /**
   * Passenger-facing coach formation when known (same shape as service detail).
   * Lets the board show stock without an extra `/api/service` request per row.
   */
  formation?: FormationData | null;
  /** PTAC unit numbers extracted from consist when present. */
  unitIds?: string[] | null;
  hasAssociations: boolean;
  hasAlerts: boolean;

  /** Convenience summary string the UI can show directly. */
  status: string;
}

export interface CoachLoadingValue {
  number: string;
  /** 0–100% occupancy. */
  value: number;
}

/**
 * NRCC station message (Operational Warning). Lifted straight off `uR.OW`.
 * `htmlMessage` may contain anchor/B/I tags. `plainMessage` strips them.
 */
export interface StationMessage {
  id: string;
  /** 0 = info · 1 = minor · 2 = major · 3 = severe */
  severity: number;
  category: string;
  htmlMessage: string;
  plainMessage: string;
  stations: string[];   // CRS list
  receivedAt: string;
}

export interface DeparturesSnapshot {
  tiploc: string;
  /**
   * Full set of TIPLOCs aggregated into this snapshot. Present only when
   * a CRS resolved to >1 TIPLOC and departures from all of them have been
   * merged (e.g. STP -> [STPXBOX, STPX, STPANCI]).
   */
  tiplocs?: string[];
  stationName: string | null;
  stationCrs:  string | null;
  /** How the URL code matched: 'tiploc' | 'crs'. */
  matchedAs?: 'tiploc' | 'crs';
  /** Other TIPLOCs sharing the same CRS (e.g. multi-platform stations). */
  alternates?: string[];

  updatedAt: string;            // ISO8601
  timetableFile: string;
  windowHours: number;

  counts: {
    departures: number;
    arrivals: number;
    cancelled: number;
    withDelay: number;
    messages: number;
  };

  /** Currently-known NRCC messages affecting this station, sorted severest first. */
  messages: StationMessage[];

  kafka: {
    consumed: number;
    updatesApplied: number;
    startedAt: string;
    lastMessageAt: string | null;
  };

  departures: DepartureRow[];
  /** Trains arriving at this station in the window (terminators and calling arrivals). */
  arrivals?: DepartureRow[];

  /** Present when ?date= was used — Darwin service day / SSD for this board (may differ from wall-clock calendar date overnight). */
  historicalDate?: string | null;
  historicalAt?: string | null;
  historicalSavedAt?: string | null;
  /** Calendar date from the request when timed boards remap overnight (matches query ?date=). */
  wallClockDate?: string | null;
}

/**
 * Returned by GET /api/darwin/station/:code (resolution only — no departures).
 */
export interface StationResolution {
  tiploc: string;
  crs: string | null;
  name: string;
  matchedAs: 'tiploc' | 'crs';
  alternates?: string[];
}

/**
 * One calling-point entry on a service detail. Mirrors the daemon's
 * `buildServiceDetail` output. Junctions/passing points are included so
 * timing-only stops (PP) appear in the chronological list.
 */
export interface ServiceStop {
  tpl: string;
  name: string | null;
  crs: string | null;
  /** OR | IP | PP | DT | OPOR | OPIP | OPPP | OPDT */
  slot: string;
  /** Public scheduled times (HH:MM). Null at origin or pass-through points. */
  pta: string | null;
  ptd: string | null;
  /** Working timetable times (HH:MM[:30] precision). */
  wta: string | null;
  wtd: string | null;
  /** Working passing time. */
  wtp: string | null;
  platform: string | null;
  livePlatform: string | null;
  /** TB / TF / T / T X / OPRM / etc. */
  activity: string | null;
  /** Live time once available (Darwin TS forecast / actual). */
  liveTime: string | null;
  liveKind: LiveTimeKind | null;
  liveSource?: string | null;
  liveSourceInstance?: string | null;
  unknownDelay?: boolean;
  manualUnknownDelay?: boolean;
  trainLength?: number | null;
  platformSource?: string | null;
  platformConfirmed?: boolean;
  platformSuppressed?: boolean;
  /** True when this specific stop has been cancelled in the live overlay. */
  cancelledAtStop: boolean;
  /** Reason for the per-stop cancellation when one was supplied (partial cancellations). */
  cancelReasonAtStop: DarwinReason | null;
  /** Per-stop overall load %, when published. */
  loadingPercentage: number | null;
  /** Per-stop, per-coach loading (0–100%). */
  coachLoading: CoachLoadingValue[] | null;
}

export interface FormationCoach {
  number: string;
  /** Standard | First | Composite | Mixed | (TOC-specific) */
  class: string;
  toilet: string | null;
  catering: string | null;
}

export interface FormationData {
  fid: string;
  coaches: FormationCoach[];
}

export interface ServiceAssociation {
  /** JJ = join · VV = divide · NP = next portion */
  category: string;
  tiploc: string;
  tiplocName: string | null;
  tiplocCrs: string | null;
  mainRid: string;
  assocRid: string;
  /** Whether this RID is the main side of the association or the associated side. */
  role: 'main' | 'associated';
  otherRid: string;
  otherTrainId: string | null;
  otherToc: string | null;
  otherOriginName: string | null;
  otherDestinationName: string | null;
  mainTime: string | null;
  assocTime: string | null;
  isCancelled: boolean;
  isDeleted: boolean;
}

export interface ServiceAlert {
  id: string;
  type: string;
  audience: string;
  source: string;
  text: string;
  locations: string[];
}

/**
 * Returned by GET /api/darwin/service/:rid — full per-service detail.
 */
export interface ServiceDetail {
  rid: string;
  uid: string;
  trainId: string;
  ssd: string;                 // YYYY-MM-DD service start date
  toc: string;
  tocName: string | null;
  trainCat: string | null;
  isPassenger: boolean;
  origin: string;
  originName: string | null;
  destination: string;
  destinationName: string | null;
  cancelled: boolean;
  cancellation: DarwinReason | null;
  /** True when the whole service is running but one or more individual stops are cancelled. */
  partiallyCancelled: boolean;
  delayReason:  DarwinReason | null;
  reverseFormation: boolean;
  formation: FormationData | null;
  /**
   * Network Rail PTAC (S506) consist — physical-reality view of the train.
   * Where Darwin's `formation` describes what passengers see (Standard /
   * First / coach numbers), PTAC tells us the actual unit numbers, vehicle
   * IDs, fleet/class, individual seat counts, max speed, brake type, and
   * open defects per coach. Null when no PTAC message has been joined yet.
   */
  consist: ConsistData | null;
  associations: ServiceAssociation[];
  alerts: ServiceAlert[];
  stops: ServiceStop[];
  /** Present when served from historical snapshot query mode. */
  historicalDate?: string | null;
  historicalAt?: string | null;
  historicalSavedAt?: string | null;
  updatedAt: string;
}

/* ===========================================================================
 * PTAC consist types — Network Rail S506 Passenger Train Allocation feed.
 * Mirrors `consist-parser.mjs` output exactly so the daemon can JSON-stringify
 * and the front-end can JSON-parse without translation.
 * ========================================================================= */

export interface ConsistData {
  parsedAt: string;
  /** Numeric PTAC TOC code, e.g. "9980". */
  company: string | null;
  /** Best-effort Darwin/CIF mapping (e.g. "SE", "XR"); may be null. */
  companyDarwin: string | null;
  /** Train identifier from PTAC, format `<headcode><uid>` (e.g. "1S20P74285"). */
  core: string | null;
  diagramDate: string | null;
  allocations: PtacAllocation[];
}

export interface PtacAllocation {
  sequenceNumber: number | null;
  trainOrigin: PtacLocation | null;
  trainOriginDateTime: string | null;
  trainDest: PtacLocation | null;
  trainDestDateTime: string | null;
  /** 1 = leading, 2 = trailing, etc. */
  resourceGroupPosition: number | null;
  diagramDate: string | null;
  diagramNo: string | null;
  allocationOrigin: PtacLocation | null;
  allocationOriginDateTime: string | null;
  allocationOriginMiles: number | null;
  allocationDestination: PtacLocation | null;
  allocationDestinationDateTime: string | null;
  allocationDestinationMiles: number | null;
  /** True when this resource group is running reversed end-on. */
  reversed: boolean;
  resourceGroups: PtacResourceGroup[];
}

export interface PtacLocation {
  tiploc: string | null;
  primaryCode: string | null;
  country: string | null;
}

export interface PtacResourceGroup {
  /** Unit number (e.g. "158756"). */
  unitId: string | null;
  /** Code (U=multiple unit, L=loco+coaches, S=single car, C=coaches). */
  typeOfResource: string | null;
  typeOfResourceLabel: string | null;
  /** Class identifier (e.g. "158/7", "345/0"). */
  fleetId: string | null;
  status: string | null;
  endOfDayMiles: number | null;
  preassignment: PtacPreassignment | null;
  vehicles: PtacVehicle[];
}

export interface PtacPreassignment {
  requiredLocation: PtacLocation | null;
  dueDateTime: string | null;
  reason: string | null;
  assignedAt: string | null;
}

export interface PtacVehicle {
  vehicleId: string | null;
  typeOfVehicle: string | null;
  position: number | null;
  plannedGroupId: string | null;
  /** Sub-type code (e.g. "DP2510J"). */
  specificType: string | null;
  lengthMm: number | null;
  weightTonnes: number | null;
  livery: string | null;
  decor: string | null;
  specialCharacteristics: string | null;
  numberOfSeats: number | null;
  vehicleStatus: string | null;
  registeredStatus: string | null;
  registeredStatusLabel: string | null;
  cabs: number | null;
  dateEnteredService: string | null;
  dateRegistered: string | null;
  registeredCategory: string | null;
  registeredCategoryLabel: string | null;
  vehicleName: string | null;
  trainBrakeType: string | null;
  trainBrakeTypeLabel: string | null;
  maximumSpeedMph: number | null;
  restrictiveMaximumSpeedMph: number | null;
  radioNumberA: string | null;
  radioNumberB: string | null;
  defects: PtacDefect[];
}

export interface PtacDefect {
  maintenanceUid: string | null;
  code: string | null;
  location: string | null;
  description: string | null;
  status: string | null;
  statusLabel: string | null;
}

/**
 * Returned by GET /api/darwin/unit/:resourceGroupId — a physical unit's
 * day-long diagram across the trains it has worked.
 */
export interface UnitDetail {
  unitId: string;
  fleetId: string | null;
  vehicles: PtacVehicle[];
  lastSeenRid: string | null;
  endOfDayMileageByDate?: Record<string, number>;
  lastEndOfDayMiles?: number | null;
  updatedAt: string;
  services: Array<{
    rid: string;
    headcode: string | null;
    start: string | null;        // ISO8601
    end: string | null;
    startTpl: string | null;
    endTpl:   string | null;
    startName: string | null;
    endName:   string | null;
    position: number | null;
    reversed: boolean;
  }>;
}

export interface BashPlanLeg {
  rid: string
  trainId: string
  fromCrs: string
  fromName: string
  toCrs: string
  toName: string
  dep: string
  arr: string
  fromTpl?: string | null
  toTpl?: string | null
  fromPlat?: string | null
  toPlat?: string | null
  board?: DepartureRow | null
}

export interface BashRiskyConnection {
  rid: string
  trainId: string
  destCrs: string
  destName: string
  dep: string
  minsAfterArrival: number
}

export interface BashPlanHop {
  fromCrs: string
  fromName: string
  toCrs: string
  toName: string
  dep: string
  arr: string
  waitMin: number
  arriveAtFrom?: string
  boardPlatform?: string | null
  alightPlatform?: string | null
  prevAlightPlatform?: string | null
  platformChange?: boolean
  legs: BashPlanLeg[]
  riskyConnections: BashRiskyConnection[]
}

export interface BashPlanResult {
  ok: boolean
  error?: string
  date?: string
  at?: string
  start?: { crs: string; name: string }
  end?: { crs: string; name: string }
  safeWaitMin?: number
  visitOrder?: Array<{ crs: string; name: string; arr: string; waitMin: number }>
  hops?: BashPlanHop[]
  totalMin?: number
  caution?: string
  finishAt?: string
}
