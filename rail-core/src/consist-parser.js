/**
 * PTAC (S506 Passenger Train Allocation and Consist) parser.
 *
 * Consumes the raw XML body delivered by the Network Rail Confluent topic
 * `prod-1033-Passenger-Train-Allocation-and-Consist-1_0` and returns a
 * normalised JavaScript object we can store in memory + persist to disk.
 *
 * The XML schema (LINX XML v095, era.europa.eu/schemes/TAFTSI/5.3) supports
 * a wide range of optional fields. We preserve every documented field that's
 * useful for a passenger / railfan UI:
 *   - Allocation: origin/destination + diagram + reversed flag
 *   - ResourceGroup: unit number, fleet/class, type, status, end-of-day miles
 *   - Vehicle: ID, position, type, length, weight, livery, seats, max speed,
 *              brake type, cabs, dates entered service, registered category
 *   - Defect: code, location, description, status — full open-fault list
 *
 * Codes are kept verbatim (single letters / short codes) and humanised by
 * tables exported alongside, so consumers can choose to display either.
 */
import { XMLParser } from 'fast-xml-parser';

// fast-xml-parser config: treat known repeating elements as arrays even if
// only one is present, leave numeric strings as strings (we cast at use),
// keep XML attributes prefixed with @_.
const parser = new XMLParser({
  ignoreAttributes:    false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  parseTagValue:       false,
  trimValues:          true,
  isArray: (name) => [
    'Allocation',
    'ResourceGroup',
    'Vehicle',
    'Defect',
    'TransportOperationalIdentifiers',
  ].includes(name),
});

// Helper: extract text content from a fast-xml-parser node that may carry
// either bare text or {text + attrs}.
function txt(n) {
  if (n == null) return null;
  if (typeof n === 'object') return n['#text'] ?? null;
  return String(n);
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull the operating-TOC variant out of the array of TransportOperational-
 * Identifiers. The feed publishes one entry per "lens" (operating TOC and
 * the LINX system itself, code "0070"); we want the operating one.
 */
function pickIdentifier(tiArr) {
  const list = Array.isArray(tiArr) ? tiArr : (tiArr ? [tiArr] : []);
  return list.find((t) => String(t.Company) !== '0070') || list[0] || {};
}

/**
 * Normalise a single PTAC location element (TrainOriginLocation, AllocationOriginLocation, etc.)
 * into { tiploc, primaryCode, country }.
 */
function normaliseLocation(loc) {
  if (!loc) return null;
  return {
    tiploc:      txt(loc.LocationSubsidiaryIdentification?.LocationSubsidiaryCode) || null,
    primaryCode: loc.LocationPrimaryCode ? String(loc.LocationPrimaryCode) : null,
    country:     loc.CountryCodeISO || null,
  };
}

// ---------------------------------------------------------------------------
// Reference tables for friendlier display — kept alongside parser so the
// daemon can attach humanised values when serving the API.

/** TypeOfResource code → human-readable label (LINX spec §3.2.5.1). */
export const TYPE_OF_RESOURCE = {
  U: 'Multiple unit',
  L: 'Locomotive + coaches',
  S: 'Single car unit',
  C: 'Coaches',
};

/** RegisteredCategory single-char code → label (RSL). */
export const REGISTERED_CATEGORY = {
  A: 'Privately owned freight',
  B: 'Privately owned international ferry freight',
  C: 'BR revenue freight',
  D: 'BR international ferry freight',
  E: 'Foreign-administration freight',
  F: 'BR service department vehicles',
  G: 'Loco-hauled passenger coaching stock',
  H: 'Loco-hauled non-passenger coaching stock',
  I: 'International loco-hauled passenger coaching',
  J: 'Diesel mechanical multiple unit (passenger)',
  K: 'Diesel electric multiple unit (passenger)',
  L: 'Electric multiple unit (passenger)',
  N: 'European passenger train',
  P: 'Diesel mechanical multiple unit (non-pass)',
  Q: 'Electric multiple unit (non-passenger)',
  R: 'Privately owned passenger coaching',
  S: 'Locomotive',
  T: 'Departmental locomotive',
  X: 'Service department multiple unit',
  Y: 'Privately owned locomotive',
};

/** RegisteredStatus single-char code → label. */
export const REGISTERED_STATUS = {
  A: 'Planned / under construction',
  B: 'On trials',
  C: 'Operational',
  D: 'Obsolescent',
  E: 'Obsolete',
  F: 'Withdrawn from use',
  G: 'Record disposed',
  I: 'De-registered (GM/RT2453)',
  P: 'Proposed for deletion',
  Y: 'Renumbered',
  Z: 'Number allocated',
};

/** TrainBrakeType single-char code → label. */
export const TRAIN_BRAKE_TYPE = {
  A: 'Air',
  E: 'EP / electro-pneumatic',
  V: 'Vacuum',
  X: 'Air + vacuum',
};

/** Defect status code → label. */
export const DEFECT_STATUS = {
  O: 'Open',
  C: 'Closed',
  P: 'Pending',
};

/**
 * PTAC numeric "Company" code → likely Darwin/CIF TOC code. Built up from
 * what we observe joining real messages to Darwin RIDs. Daemon will refine
 * dynamically by recording the TOC of every successful join.
 */
export const KNOWN_PTAC_TOC = {
  '9933': 'XR',  // Elizabeth Line
  '9980': 'SE',  // Southeastern
  '9984': 'SW',  // South Western Railway
  '9971': 'NT',  // Northern (observed)
  '9925': 'TP',  // TransPennine Express (observed)
  '9923': 'EM',  // East Midlands Railway (per spec example)
  '9986': 'HX',  // Heathrow Express (likely)
};

// ---------------------------------------------------------------------------

/**
 * Parse a single Defect element into a clean object.
 */
function parseDefect(d) {
  return {
    maintenanceUid:  d.MaintenanceUID ? String(d.MaintenanceUID) : null,
    code:            d.DefectCode || null,
    location:        d.MaintenanceDefectLocation || null,
    description:     d.DefectDescription ? String(d.DefectDescription).replace(/\s+/g, ' ').trim() : null,
    status:          d.DefectStatus || null,
    statusLabel:     DEFECT_STATUS[d.DefectStatus] || null,
  };
}

/**
 * Parse a Vehicle element into a clean object preserving every documented
 * field useful to the UI. Numeric fields are cast to Number; date fields
 * are kept as strings (YYYY-MM-DD).
 */
function parseVehicle(v) {
  return {
    vehicleId:        v.VehicleId ? String(v.VehicleId) : null,
    typeOfVehicle:    v.TypeOfVehicle || null,            // C = coach, etc.
    position:         num(v.ResourcePosition),
    plannedGroupId:   v.PlannedResourceGroup ? String(v.PlannedResourceGroup) : null,
    specificType:     v.SpecificType || null,             // e.g. "DP2510F" (vehicle sub-type)
    lengthMm:         num(v.Length?.Value),
    weightTonnes:     num(v.Weight),
    livery:           v.Livery || null,
    decor:            v.Decor || null,
    specialCharacteristics: v.SpecialCharacteristics || null,
    numberOfSeats:    num(v.NumberOfSeats),
    vehicleStatus:    v.VehicleStatus || null,
    registeredStatus:      v.RegisteredStatus || null,
    registeredStatusLabel: REGISTERED_STATUS[v.RegisteredStatus] || null,
    cabs:             num(v.Cabs),
    dateEnteredService:  v.DateEnteredService || null,
    dateRegistered:      v.DateRegistered     || null,
    registeredCategory:      v.RegisteredCategory || null,
    registeredCategoryLabel: REGISTERED_CATEGORY[v.RegisteredCategory] || null,
    vehicleName:      v.VehicleName || null,              // some named units carry one
    trainBrakeType:      v.TrainBrakeType || null,
    trainBrakeTypeLabel: TRAIN_BRAKE_TYPE[v.TrainBrakeType] || null,
    maximumSpeedMph:           num(v.MaximumSpeed),
    restrictiveMaximumSpeedMph: num(v.RestrictiveMaximumSpeed),
    radioNumberA:     v.RadioNumberA || null,
    radioNumberB:     v.RadioNumberB || null,
    defects:          (v.Defect || []).map(parseDefect),
  };
}

/**
 * Parse a single ResourceGroup element.
 */
function parseResourceGroup(rg) {
  return {
    unitId:           rg.ResourceGroupId ? String(rg.ResourceGroupId) : null,
    typeOfResource:      rg.TypeOfResource || null,
    typeOfResourceLabel: TYPE_OF_RESOURCE[rg.TypeOfResource] || null,
    fleetId:          rg.FleetId || null,                  // e.g. "158/8" (class)
    status:           rg.ResourceGroupStatus || null,
    endOfDayMiles:    num(rg.EndOfDayMiles),
    preassignment:    rg.Preassignment ? {
      requiredLocation: rg.Preassignment.PreAssignmentRequiredLocation ?
        normaliseLocation(rg.Preassignment.PreAssignmentRequiredLocation) : null,
      dueDateTime:      rg.Preassignment.PreAssignmentDueDateTime || null,
      reason:           rg.Preassignment.PreAssignmentReason || null,
      assignedAt:       rg.Preassignment.PreAssignmentDateTime || null,
    } : null,
    vehicles:         (rg.Vehicle || []).map(parseVehicle),
  };
}

/**
 * Parse one Allocation element into a clean object. An Allocation describes
 * one *leg* of a service (a contiguous sub-section between split/join
 * points). A passenger train can have many allocations across its run.
 */
function parseAllocation(a) {
  return {
    sequenceNumber:   num(a.AllocationSequenceNumber),
    trainOrigin:      normaliseLocation(a.TrainOriginLocation),
    trainOriginDateTime:  a.TrainOriginDateTime || null,
    trainDest:        normaliseLocation(a.TrainDestLocation),
    trainDestDateTime:    a.TrainDestDateTime || null,
    resourceGroupPosition: num(a.ResourceGroupPosition),  // 1 = leading
    diagramDate:      a.DiagramDate || null,
    diagramNo:        a.DiagramNo   || null,
    allocationOrigin:    normaliseLocation(a.AllocationOriginLocation),
    allocationOriginDateTime: a.AllocationOriginDateTime || null,
    allocationOriginMiles:    num(a.AllocationOriginMiles),
    allocationDestination: normaliseLocation(a.AllocationDestinationLocation),
    allocationDestinationDateTime: a.AllocationDestinationDateTime || null,
    allocationDestinationMiles:    num(a.AllocationDestinationMiles),
    reversed:         a.Reversed === 'Y',
    resourceGroups:   (a.ResourceGroup || []).map(parseResourceGroup),
  };
}

/**
 * Top-level entry point. Accepts a raw XML payload (string or Buffer);
 * strips any LINX MQ control-prefix wrappers; parses; and returns a
 * normalised consist message or `null` if the payload doesn't decode.
 */
export function parseConsistMessage(xmlBuf) {
  let xml = xmlBuf == null ? '' : (typeof xmlBuf === 'string' ? xmlBuf : xmlBuf.toString('utf8'));
  // LINX MQ delivers a few control prefix tags (<usr>, <mcd>, <mqps>) ahead
  // of the XML root in some configurations. Strip everything up to the
  // first `<?xml` directive, falling back to the message root tag.
  const x = xml.indexOf('<?xml');
  if (x > 0) xml = xml.slice(x);
  else if (x < 0) {
    const r = xml.indexOf('<PassengerTrainConsistMessage');
    if (r > 0) xml = xml.slice(r);
  }
  let doc;
  try { doc = parser.parse(xml); }
  catch { return null; }
  const m = doc.PassengerTrainConsistMessage;
  if (!m) return null;
  const ti  = pickIdentifier(m.TrainOperationalIdentification?.TransportOperationalIdentifiers);
  const otn = m.OperationalTrainNumberIdentifier || {};

  return {
    messageId:        m.MessageHeader?.MessageReference?.MessageIdentifier || null,
    messageDateTime:  m.MessageHeader?.MessageReference?.MessageDateTime   || null,
    senderReference:  m.MessageHeader?.SenderReference  || null,
    sender:           txt(m.MessageHeader?.Sender),
    recipient:        txt(m.MessageHeader?.Recipient),
    status:           num(m.MessageStatus),

    objectType:       ti.ObjectType    || null,
    company:          ti.Company ? String(ti.Company) : null,    // numeric TOC
    companyDarwin:    KNOWN_PTAC_TOC[ti.Company] || null,        // best-guess CIF code
    core:             ti.Core          || null,
    variant:          ti.Variant       || null,
    timetableYear:    ti.TimetableYear || null,
    startDate:        ti.StartDate     || null,                  // YYYY-MM-DD

    headcode:         otn.OperationalTrainNumber || null,
    scheduledTimeAtHandover:    otn.ScheduledTimeAtHandover    || null,
    scheduledDateTimeAtTransfer: otn.ScheduledDateTimeAtTransfer || null,

    responsibleRu:    m.ResponsibleRU ? String(m.ResponsibleRU) : null,

    allocations:      (m.Allocation || []).map(parseAllocation),
  };
}

/**
 * Build the (ssd, headcode, originTiploc, originHHMM) join key from a
 * parsed consist message's first allocation. Returns null if any
 * essential component is missing.
 */
export function consistJoinKey(parsed) {
  const a0 = parsed?.allocations?.[0];
  if (!a0) return null;
  const tpl = a0.trainOrigin?.tiploc;
  const dt  = a0.trainOriginDateTime;
  if (!parsed.startDate || !parsed.headcode || !tpl || !dt) return null;
  return {
    ssd:         parsed.startDate,
    headcode:    parsed.headcode,
    originTpl:   tpl,
    originHHMM:  dt.slice(11, 16),
  };
}
