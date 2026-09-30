/*
 * Share a tune (PIDs, rates, filters) between aircraft as a short text code.
 *
 * A tune is taken from a CLI `diff` (active profiles only, values that differ from defaults) and
 * reduced to the settings that shape how the aircraft flies. Everything tied to one particular
 * build — resources, ports, modes, mixer, motor protocol and poles, bidirectional DShot, loop
 * rate, failsafe, battery, VTX, OSD, receiver — is left out, because pasting it onto another
 * flight controller can break that aircraft.
 *
 * Import is the security boundary: a code comes from someone else, so every line is checked
 * against the same allow-list before it may reach the CLI. A code can never carry `resource`,
 * `save`, `defaults` or any setting outside the tune.
 */

/** Filter settings that live in the master section of a diff but belong to the tune. */
const MASTER_TUNE_SETTINGS: ReadonlySet<string> = new Set([
    // gyro lowpass / notch (PG_GYRO_CONFIG, filter entries only)
    "gyro_lpf1_type",
    "gyro_lpf1_static_hz",
    "gyro_lpf1_dyn_min_hz",
    "gyro_lpf1_dyn_max_hz",
    "gyro_lpf1_dyn_expo",
    "gyro_lpf2_type",
    "gyro_lpf2_static_hz",
    "gyro_notch1_hz",
    "gyro_notch1_cutoff",
    "gyro_notch2_hz",
    "gyro_notch2_cutoff",
    "simplified_gyro_filter",
    "simplified_gyro_filter_multiplier",
    // dynamic notch (PG_DYN_NOTCH_CONFIG)
    "dyn_notch_count",
    "dyn_notch_q",
    "dyn_notch_min_hz",
    "dyn_notch_max_hz",
    // RPM filter (PG_RPM_FILTER_CONFIG)
    "rpm_filter_harmonics",
    "rpm_filter_weights",
    "rpm_filter_q",
    "rpm_filter_min_hz",
    "rpm_filter_fade_range_hz",
    "rpm_filter_lpf_hz",
    // RC smoothing (PG_RX_CONFIG, smoothing entries only)
    "rc_smoothing",
    "rc_smoothing_auto_factor",
    "rc_smoothing_auto_factor_throttle",
    "rc_smoothing_setpoint_cutoff",
    "rc_smoothing_throttle_cutoff",
]);

/**
 * PID profile settings (PG_PID_PROFILE) that are part of a tune.
 * Left out on purpose: auto_profile_cell_count (tied to the owner's batteries), chirp_* (Autotune
 * test signal, not a tune) and acro_trainer_debug_axis (debug only).
 */
const PID_PROFILE_TUNE_SETTINGS: ReadonlySet<string> = new Set([
    "profile_name",
    "p_pitch",
    "i_pitch",
    "d_pitch",
    "f_pitch",
    "p_roll",
    "i_roll",
    "d_roll",
    "f_roll",
    "p_yaw",
    "i_yaw",
    "d_yaw",
    "f_yaw",
    "s_pitch",
    "s_roll",
    "s_yaw",
    "d_max_roll",
    "d_max_pitch",
    "d_max_yaw",
    "d_max_gain",
    "d_max_advance",
    "dterm_lpf1_dyn_min_hz",
    "dterm_lpf1_dyn_max_hz",
    "dterm_lpf1_dyn_expo",
    "dterm_lpf1_type",
    "dterm_lpf1_static_hz",
    "dterm_lpf2_type",
    "dterm_lpf2_static_hz",
    "dterm_notch_hz",
    "dterm_notch_cutoff",
    "vbat_sag_compensation",
    "pid_at_min_throttle",
    "anti_gravity_gain",
    "anti_gravity_cutoff_hz",
    "anti_gravity_p_gain",
    "acc_limit_yaw",
    "acc_limit",
    "crash_dthreshold",
    "crash_gthreshold",
    "crash_setpoint_threshold",
    "crash_time",
    "crash_delay",
    "crash_recovery_angle",
    "crash_recovery_rate",
    "crash_limit_yaw",
    "crash_recovery",
    "iterm_rotation",
    "iterm_relax",
    "iterm_relax_type",
    "iterm_relax_cutoff",
    "iterm_windup",
    "pidsum_limit",
    "pidsum_limit_yaw",
    "yaw_lowpass_hz",
    "throttle_boost",
    "throttle_boost_cutoff",
    "acro_trainer_angle_limit",
    "acro_trainer_lookahead_ms",
    "acro_trainer_gain",
    "angle_p_gain",
    "angle_feedforward",
    "angle_feedforward_smoothing_ms",
    "angle_limit",
    "angle_earth_ref",
    "angle_pitch_offset",
    "horizon_level_strength",
    "horizon_limit_sticks",
    "horizon_limit_degrees",
    "horizon_ignore_sticks",
    "horizon_delay_ms",
    "motor_output_limit",
    "launch_control_mode",
    "launch_trigger_allow_reset",
    "launch_trigger_throttle_percent",
    "launch_angle_limit",
    "launch_control_gain",
    "thrust_linear",
    "feedforward_transition",
    "feedforward_averaging",
    "feedforward_smooth_factor",
    "feedforward_jitter_factor",
    "feedforward_boost",
    "feedforward_max_rate_limit",
    "feedforward_yaw_hold_gain",
    "feedforward_yaw_hold_time",
    "dyn_idle_min_rpm",
    "dyn_idle_p_gain",
    "dyn_idle_i_gain",
    "dyn_idle_d_gain",
    "dyn_idle_max_increase",
    "level_race_mode",
    "simplified_pids_mode",
    "simplified_master_multiplier",
    "simplified_i_gain",
    "simplified_d_gain",
    "simplified_pi_gain",
    "simplified_d_max_gain",
    "simplified_feedforward_gain",
    "simplified_pitch_d_gain",
    "simplified_pitch_pi_gain",
    "simplified_dterm_filter",
    "simplified_dterm_filter_multiplier",
    "tpa_mode",
    "tpa_rate",
    "tpa_breakpoint",
    "tpa_low_rate",
    "tpa_low_breakpoint",
    "tpa_low_always",
    "tpa_speed_type",
    "tpa_speed_basic_delay",
    "tpa_speed_basic_gravity",
    "tpa_speed_adv_prop_pitch",
    "tpa_speed_adv_mass",
    "tpa_speed_adv_drag_k",
    "tpa_speed_adv_thrust",
    "tpa_speed_max_voltage",
    "tpa_speed_pitch_offset",
    "tpa_curve_type",
    "tpa_curve_stall_throttle",
    "tpa_curve_pid_thr0",
    "tpa_curve_pid_thr100",
    "tpa_curve_expo",
    "ez_landing_threshold",
    "ez_landing_limit",
    "ez_landing_speed",
    "landing_disarm_threshold",
    "spa_roll_center",
    "spa_roll_width",
    "spa_roll_mode",
    "spa_pitch_center",
    "spa_pitch_width",
    "spa_pitch_mode",
    "spa_yaw_center",
    "spa_yaw_width",
    "spa_yaw_mode",
    "yaw_type",
]);

/** Rate profile settings (PG_CONTROL_RATE_PROFILES) — all of them are part of a tune. */
const RATE_PROFILE_TUNE_SETTINGS: ReadonlySet<string> = new Set([
    "rateprofile_name",
    "thr_mid",
    "thr_expo",
    "thr_hover",
    "rates_type",
    "quickrates_rc_expo",
    "roll_rc_rate",
    "pitch_rc_rate",
    "yaw_rc_rate",
    "roll_expo",
    "pitch_expo",
    "yaw_expo",
    "roll_srate",
    "pitch_srate",
    "yaw_srate",
    "throttle_limit_type",
    "throttle_limit_percent",
    "roll_rate_limit",
    "pitch_rate_limit",
    "yaw_rate_limit",
]);

export type TuneSection = "master" | "profile" | "rateprofile";

const ALLOWED: Record<TuneSection, ReadonlySet<string>> = {
    master: MASTER_TUNE_SETTINGS,
    profile: PID_PROFILE_TUNE_SETTINGS,
    rateprofile: RATE_PROFILE_TUNE_SETTINGS,
};

export interface TuneSetting {
    name: string;
    value: string;
}

export interface Tune {
    master: TuneSetting[];
    profile: TuneSetting[];
    rateprofile: TuneSetting[];
}

/** `set <name> = <value>` exactly as the CLI prints it in a diff. */
const SET_LINE = /^set\s+([a-z0-9_]+)\s*=\s*(.*)$/;

/**
 * Values stay on one line and carry no command separators. Names (profile_name, rateprofile_name)
 * may hold spaces and simple punctuation, so the check is a deny-list of what could start a
 * second command rather than an allow-list of characters.
 */
const SAFE_VALUE = /^[^\r\n;#]{0,64}$/;

export function isTuneSetting(section: TuneSection, name: string): boolean {
    return ALLOWED[section].has(name);
}

function isActive(header: string, activeIndex: number | undefined): boolean {
    return activeIndex === undefined || Number(header.split(/\s+/)[1]) === activeIndex;
}

/**
 * Keep only the tune from a CLI `diff`.
 *
 * The diff lists master settings under `# master`, then the active PID profile under
 * `# profile N` and the active rate profile under `# rateprofile N`. The section a `set` line
 * sits in decides which allow-list it is checked against.
 *
 * `diff` lists only the active profiles, but `diff all` lists every one of them. Pass the active
 * indexes so a `diff all` never merges four profiles into one tune; without them every profile
 * section is read, which is only right for a plain `diff`.
 *
 * @param diffLines the lines the flight controller answered to `diff`
 * @param active the PID and rate profile the tune should come from
 */
export function extractTune(
    diffLines: readonly string[],
    active: { pidProfile?: number; rateProfile?: number } = {},
): Tune {
    const tune: Tune = { master: [], profile: [], rateprofile: [] };
    let section: TuneSection | null = null;

    for (const raw of diffLines) {
        const line = raw.trim();

        if (line.startsWith("#")) {
            const header = line.slice(1).trim().toLowerCase();
            if (header === "master") {
                section = "master";
            } else if (/^profile\s+\d+$/.test(header)) {
                section = isActive(header, active.pidProfile) ? "profile" : null;
            } else if (/^rateprofile\s+\d+$/.test(header)) {
                section = isActive(header, active.rateProfile) ? "rateprofile" : null;
            } else {
                // Any other header (feature, serial, aux, ...) ends the section we were in.
                section = null;
            }
            continue;
        }

        if (!section) {
            continue;
        }

        const match = SET_LINE.exec(line);
        if (!match) {
            continue;
        }

        const [, name, value] = match;
        if (isTuneSetting(section, name) && SAFE_VALUE.test(value)) {
            // A setting listed twice keeps its last value, as the CLI would when replaying it.
            const list = tune[section];
            const existing = list.findIndex((setting) => setting.name === name);
            if (existing !== -1) {
                list.splice(existing, 1);
            }
            list.push({ name, value: value.trim() });
        }
    }

    return tune;
}

/** Why a line of an imported tune was not accepted. */
export interface RejectedSetting extends TuneSetting {
    section: TuneSection;
    reason: "not-a-tune-setting" | "unsafe-value";
}

/**
 * Check a tune that came from someone else. Returns the settings that may be applied and the
 * ones that were dropped, so the import preview can show both.
 */
export function validateTune(tune: Tune): { accepted: Tune; rejected: RejectedSetting[] } {
    const accepted: Tune = { master: [], profile: [], rateprofile: [] };
    const rejected: RejectedSetting[] = [];

    for (const section of ["master", "profile", "rateprofile"] as const) {
        for (const setting of tune[section] ?? []) {
            const name = String(setting?.name ?? "");
            const value = String(setting?.value ?? "");

            if (!isTuneSetting(section, name)) {
                rejected.push({ section, name, value, reason: "not-a-tune-setting" });
            } else if (!SAFE_VALUE.test(value)) {
                rejected.push({ section, name, value, reason: "unsafe-value" });
            } else {
                accepted[section].push({ name, value: value.trim() });
            }
        }
    }

    return { accepted, rejected };
}

/**
 * The CLI commands that apply a validated tune to the currently selected PID and rate profile.
 * No `profile`/`rateprofile` switch is emitted: the tune always lands where the user is looking.
 */
export function tuneToCliCommands(tune: Tune): string[] {
    return [...tune.master, ...tune.profile, ...tune.rateprofile].map(({ name, value }) => `set ${name} = ${value}`);
}

export function tuneSettingCount(tune: Tune): number {
    return tune.master.length + tune.profile.length + tune.rateprofile.length;
}

/* ------------------------------------------------------------------------------------------------
 * Share code: "BFTUNE1:" + base64url(deflate-raw(JSON)). Compact enough for a QR code, and the
 * prefix lets import reject anything that is not a tune before decoding it.
 * --------------------------------------------------------------------------------------------- */

export const TUNE_CODE_PREFIX = "BFTUNE1:";

/** Largest code accepted on import, so a pasted blob can't make the app inflate something huge. */
const MAX_CODE_LENGTH = 8192;
const MAX_JSON_LENGTH = 65536;

/** Facts about the sender's aircraft that the receiver needs for its safety checks. */
export interface TuneOrigin {
    /** Firmware version the tune was taken from, e.g. "2025.12.1". */
    firmware: string;
    /** RPM filtering was active: bidirectional DShot on and rpm_filter_harmonics > 0. */
    rpmFilter: boolean;
}

export interface SharedTune {
    origin: TuneOrigin;
    tune: Tune;
}

interface Payload {
    v: 1;
    fw: string;
    rpm: boolean;
    m: [string, string][];
    p: [string, string][];
    r: [string, string][];
}

const pack = (settings: TuneSetting[]): [string, string][] => settings.map(({ name, value }) => [name, value]);
const unpack = (rows: unknown): TuneSetting[] =>
    Array.isArray(rows)
        ? rows
              .filter((row): row is [unknown, unknown] => Array.isArray(row) && row.length === 2)
              .map(([name, value]) => ({ name: String(name), value: String(value) }))
        : [];

/**
 * Run bytes through a (de)compression stream. Written against the stream itself rather than
 * Blob/Response so it behaves the same in every host, including jsdom under test.
 */
async function transform(
    bytes: Uint8Array<ArrayBuffer>,
    stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
    const writer = stream.writable.getWriter();
    const written = writer.write(bytes).then(() => writer.close());
    // A damaged input rejects both sides; the reader reports it, so don't let this one go unhandled.
    written.catch(() => {});

    const chunks: Uint8Array[] = [];
    const reader = stream.readable.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        chunks.push(value);
    }
    await written;

    const output = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
    }
    return output;
}

function toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
    const base64 = text.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function encodeTune({ origin, tune }: SharedTune): Promise<string> {
    const payload: Payload = {
        v: 1,
        fw: origin.firmware,
        rpm: origin.rpmFilter,
        m: pack(tune.master),
        p: pack(tune.profile),
        r: pack(tune.rateprofile),
    };
    const json = new TextEncoder().encode(JSON.stringify(payload));
    const compressed = await transform(json, new CompressionStream("deflate-raw"));
    return TUNE_CODE_PREFIX + toBase64Url(compressed);
}

export class InvalidTuneCodeError extends Error {}

/**
 * Decode a share code. The result is NOT yet safe to apply — pass `tune` through `validateTune`.
 * @throws InvalidTuneCodeError when the text is not a tune code this version understands
 */
export async function decodeTune(code: string): Promise<SharedTune> {
    const text = code.replace(/\s+/g, "");
    if (!text.startsWith(TUNE_CODE_PREFIX) || text.length > MAX_CODE_LENGTH) {
        throw new InvalidTuneCodeError("Not a tune code");
    }

    let payload: Partial<Payload>;
    try {
        const inflated = await transform(
            fromBase64Url(text.slice(TUNE_CODE_PREFIX.length)),
            new DecompressionStream("deflate-raw"),
        );
        if (inflated.length > MAX_JSON_LENGTH) {
            throw new Error("too large");
        }
        payload = JSON.parse(new TextDecoder().decode(inflated));
    } catch {
        throw new InvalidTuneCodeError("Tune code is damaged");
    }

    if (payload?.v !== 1) {
        throw new InvalidTuneCodeError("Unsupported tune code version");
    }

    return {
        origin: { firmware: String(payload.fw ?? ""), rpmFilter: payload.rpm === true },
        tune: { master: unpack(payload.m), profile: unpack(payload.p), rateprofile: unpack(payload.r) },
    };
}

/* ------------------------------------------------------------------------------------------------
 * Links. A QR code can carry the tune as `https://app.betaflight.com/?tune=BFTUNE1:...`, following
 * the `?connect=` deeplink: a phone camera opens the app, and the app offers the import.
 * --------------------------------------------------------------------------------------------- */

export const TUNE_LINK_BASE = "https://app.betaflight.com/";
export const TUNE_LINK_PARAM = "tune";

export function tuneLink(code: string): string {
    return `${TUNE_LINK_BASE}?${TUNE_LINK_PARAM}=${code}`;
}

/**
 * The share code in whatever the user pasted or a link carried: the bare code, or a link with a
 * `tune` parameter. Returns null when there is no code in it. The code is not decoded here.
 */
export function findTuneCode(text: string): string | null {
    const trimmed = text.trim();
    const compact = trimmed.replace(/\s+/g, "");

    if (compact.startsWith(TUNE_CODE_PREFIX)) {
        return compact;
    }

    try {
        const value = new URL(trimmed).searchParams.get(TUNE_LINK_PARAM)?.replace(/\s+/g, "");
        return value?.startsWith(TUNE_CODE_PREFIX) ? value : null;
    } catch {
        return null;
    }
}

/** One row of the import preview. */
export interface TuneChange extends TuneSetting {
    section: TuneSection;
    /** The value on the flight controller now, or null when this firmware has no such setting. */
    current: string | null;
}

/** Settings compare as the CLI prints them: case and spacing around commas do not matter. */
export function sameSettingValue(a: string | null, b: string): boolean {
    const normalize = (value: string) =>
        value
            .replace(/\s*,\s*/g, ",")
            .trim()
            .toLowerCase();
    return a !== null && normalize(a) === normalize(b);
}

/**
 * The tune code named by a `?tune=` query parameter, if it is one. Untrusted input — whatever a
 * link contained — so only something shaped like a share code is passed on, and it still has to
 * go through decodeTune and validateTune before anything reaches the flight controller.
 * @param search - a URL query string, e.g. window.location.search ("?tune=BFTUNE1:…").
 */
export function parseTuneDeeplink(search: string): string | null {
    let value: string | null;
    try {
        value = new URLSearchParams(search).get(TUNE_LINK_PARAM);
    } catch {
        return null;
    }

    const code = (value ?? "").replace(/\s+/g, "");
    return code.startsWith(TUNE_CODE_PREFIX) && code.length <= MAX_CODE_LENGTH ? code : null;
}
