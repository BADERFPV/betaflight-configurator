import { describe, expect, it } from "vitest";

import {
    InvalidTuneCodeError,
    TUNE_CODE_PREFIX,
    decodeTune,
    encodeTune,
    extractTune,
    tuneToCliCommands,
    validateTune,
} from "../../src/js/utils/tuneShare";

// Shaped like a real `diff` answer: board lines, then master, then the active profiles.
const DIFF = `
# version
# Betaflight / STM32F7X2 (S7X2) 2025.12.1 Jan  1 2026 / 00:00:00 (abcdef) MSP API: 1.47

# start the command batch
batch start

board_name SPEEDYBEEF7V3
manufacturer_id SPBE

# resources
resource MOTOR 1 B04

# feature
feature -AIRMODE

# serial
serial 0 64 115200 57600 0 115200

# aux
aux 0 0 0 1700 2100 0 0

# master
set gyro_lpf1_static_hz = 0
set gyro_lpf2_static_hz = 500
set dyn_notch_count = 1
set dyn_notch_q = 500
set rpm_filter_weights = 100,100,80
set rc_smoothing_auto_factor = 45
set dshot_bidir = ON
set motor_pwm_protocol = DSHOT300
set motor_poles = 12
set serialrx_provider = CRSF
set pid_process_denom = 1
set small_angle = 180
set gyro_calib_duration = 200

profile 1

# profile 1
set profile_name = Freestyle 5
set p_pitch = 52
set d_roll = 38
set f_yaw = 110
set auto_profile_cell_count = 6
set chirp_amplitude_roll = 300

rateprofile 2

# rateprofile 2
set rateprofile_name = Bader
set roll_rc_rate = 7
set roll_srate = 80

# end the command batch
batch end
`.split("\n");

describe("extractTune", () => {
    const tune = extractTune(DIFF);

    it("keeps only filter and RC smoothing settings from master", () => {
        expect(tune.master.map((s) => s.name)).toEqual([
            "gyro_lpf1_static_hz",
            "gyro_lpf2_static_hz",
            "dyn_notch_count",
            "dyn_notch_q",
            "rpm_filter_weights",
            "rc_smoothing_auto_factor",
        ]);
    });

    it("drops board-specific master settings", () => {
        const names = tune.master.map((s) => s.name);
        for (const boardSetting of [
            "dshot_bidir",
            "motor_pwm_protocol",
            "motor_poles",
            "serialrx_provider",
            "pid_process_denom",
            "small_angle",
            "gyro_calib_duration",
        ]) {
            expect(names).not.toContain(boardSetting);
        }
    });

    it("keeps the PID profile but not battery-tied or Autotune settings", () => {
        expect(tune.profile).toEqual([
            { name: "profile_name", value: "Freestyle 5" },
            { name: "p_pitch", value: "52" },
            { name: "d_roll", value: "38" },
            { name: "f_yaw", value: "110" },
        ]);
    });

    it("keeps the rate profile", () => {
        expect(tune.rateprofile.map((s) => s.name)).toEqual(["rateprofile_name", "roll_rc_rate", "roll_srate"]);
    });

    it("never emits resources, serial, aux or feature lines", () => {
        const commands = tuneToCliCommands(tune).join("\n");
        expect(commands).not.toMatch(/resource|serial |aux |feature|board_name|batch/);
    });
});

describe("validateTune", () => {
    it("rejects settings outside the tune, even in the profile section", () => {
        const { accepted, rejected } = validateTune({
            master: [{ name: "motor_poles", value: "14" }],
            profile: [
                { name: "p_roll", value: "45" },
                { name: "serialrx_provider", value: "SBUS" },
            ],
            rateprofile: [],
        });

        expect(accepted.profile).toEqual([{ name: "p_roll", value: "45" }]);
        expect(rejected.map((r) => r.name)).toEqual(["motor_poles", "serialrx_provider"]);
    });

    it("rejects values that try to smuggle a second command", () => {
        const { accepted, rejected } = validateTune({
            master: [],
            profile: [{ name: "profile_name", value: "x\nsave" }],
            rateprofile: [{ name: "rateprofile_name", value: "x; defaults" }],
        });

        expect(accepted.profile).toHaveLength(0);
        expect(accepted.rateprofile).toHaveLength(0);
        expect(rejected.every((r) => r.reason === "unsafe-value")).toBe(true);
    });
});

describe("share code", () => {
    it("round-trips a tune", async () => {
        const shared = { origin: { firmware: "2025.12.1", rpmFilter: true }, tune: extractTune(DIFF) };
        const code = await encodeTune(shared);

        expect(code.startsWith(TUNE_CODE_PREFIX)).toBe(true);
        expect(code).toMatch(/^BFTUNE1:[A-Za-z0-9_-]+$/);
        await expect(decodeTune(code)).resolves.toEqual(shared);
    });

    it("stays small enough for a QR code", async () => {
        const code = await encodeTune({ origin: { firmware: "2025.12.1", rpmFilter: true }, tune: extractTune(DIFF) });
        // A QR code holds ~2900 alphanumeric/byte characters at its largest; aim far below.
        expect(code.length).toBeLessThan(600);
    });

    it("tolerates whitespace and line breaks from a paste", async () => {
        const code = await encodeTune({ origin: { firmware: "x", rpmFilter: false }, tune: extractTune(DIFF) });
        const pasted = `  ${code.slice(0, 20)}\n${code.slice(20)}  `;
        await expect(decodeTune(pasted)).resolves.toBeTruthy();
    });

    it.each(["", "hello", "diff all", `${TUNE_CODE_PREFIX}!!!not-base64!!!`, `${TUNE_CODE_PREFIX}AAAA`])(
        "rejects %j",
        async (code) => {
            await expect(decodeTune(code)).rejects.toBeInstanceOf(InvalidTuneCodeError);
        },
    );
});

describe("extractTune with diff all", () => {
    const DIFF_ALL = `
# master
set dyn_notch_count = 1

profile 0

# profile 0
set p_roll = 40

profile 1

# profile 1
set p_roll = 60

rateprofile 0

# rateprofile 0
set roll_rc_rate = 5

rateprofile 1

# rateprofile 1
set roll_rc_rate = 9

# restore original profile selection
profile 1
`.split("\n");

    it("takes only the active profiles", () => {
        const tune = extractTune(DIFF_ALL, { pidProfile: 1, rateProfile: 0 });
        expect(tune.profile).toEqual([{ name: "p_roll", value: "60" }]);
        expect(tune.rateprofile).toEqual([{ name: "roll_rc_rate", value: "5" }]);
        expect(tune.master).toEqual([{ name: "dyn_notch_count", value: "1" }]);
    });
});

it("keeps one entry per setting when a diff repeats a line", () => {
    const tune = extractTune(["# master", "set dyn_notch_q = 300", "set dyn_notch_q = 500"]);
    expect(tune.master).toEqual([{ name: "dyn_notch_q", value: "500" }]);
});
