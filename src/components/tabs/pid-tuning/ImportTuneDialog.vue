<template>
    <Dialog
        :model-value="modelValue"
        :title="$t('pidTuningImportTuneTitle')"
        :closeable="state !== 'applying'"
        @update:model-value="onOpenChange"
    >
        <div class="flex flex-col gap-3 text-sm">
            <!-- 1. Paste -->
            <template v-if="state === 'input'">
                <p>{{ $t("pidTuningImportTuneIntro") }}</p>
                <UTextarea
                    v-model="pasted"
                    :rows="4"
                    autofocus
                    class="w-full font-mono"
                    :ui="{ base: 'break-all text-xs' }"
                    :placeholder="$t('pidTuningImportTunePlaceholder')"
                />
                <p v-if="errorMessage" class="text-error">{{ errorMessage }}</p>
            </template>

            <!-- Reading current values / writing -->
            <div v-else-if="state === 'reading' || state === 'applying'" class="flex items-center gap-2">
                <UIcon name="i-lucide-loader-circle" class="animate-spin" />
                <span>
                    {{
                        state === "reading"
                            ? $t("pidTuningImportTuneReading")
                            : $t("pidTuningImportTuneApplying", { done: progress, total: changed.length })
                    }}
                </span>
            </div>

            <!-- Cannot import at all -->
            <p v-else-if="state === 'blocked'" class="text-error">{{ errorMessage }}</p>

            <!-- 2. Preview -->
            <template v-else-if="state === 'preview'">
                <p>
                    {{
                        $t("pidTuningImportTuneTarget", {
                            profile: pidProfile + 1,
                            rateProfile: rateProfile + 1,
                        })
                    }}
                </p>

                <UAlert
                    v-if="rpmMismatch"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :title="$t('pidTuningImportTuneRpmTitle')"
                    :description="$t('pidTuningImportTuneRpmText')"
                />
                <UAlert
                    v-if="firmwareMismatch"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-info"
                    :description="$t('pidTuningImportTuneFirmware', { theirs: origin.firmware, ours: currentFirmware })"
                />

                <p v-if="changed.length === 0">{{ $t("pidTuningImportTuneNothingChanges") }}</p>
                <div v-else class="max-h-64 overflow-auto rounded border border-default">
                    <table class="w-full text-xs">
                        <thead class="sticky top-0 bg-elevated text-left">
                            <tr>
                                <th class="px-2 py-1">{{ $t("pidTuningImportTuneSetting") }}</th>
                                <th class="px-2 py-1 text-right">{{ $t("pidTuningImportTuneCurrent") }}</th>
                                <th class="px-2 py-1"></th>
                                <th class="px-2 py-1">{{ $t("pidTuningImportTuneNew") }}</th>
                            </tr>
                        </thead>
                        <tbody class="font-mono">
                            <tr
                                v-for="row in changed"
                                :key="`${row.section}.${row.name}`"
                                class="border-t border-default"
                            >
                                <td class="px-2 py-1">{{ row.name }}</td>
                                <td class="px-2 py-1 text-right text-muted">{{ row.current ?? "—" }}</td>
                                <td class="px-1 py-1 text-muted">→</td>
                                <td class="px-2 py-1 font-semibold">{{ row.value }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <p v-if="unchangedCount > 0" class="text-muted">
                    {{ $t("pidTuningImportTuneUnchanged", { count: unchangedCount }) }}
                </p>
                <p v-if="skipped.length > 0" class="text-muted">
                    {{ $t("pidTuningImportTuneSkipped", { names: skipped.join(", ") }) }}
                </p>

                <UCheckbox
                    v-if="rpmMismatch"
                    v-model="rpmAcknowledged"
                    :label="$t('pidTuningImportTuneRpmAcknowledge')"
                />
                <p class="text-muted">{{ $t("pidTuningImportTuneRebootNote") }}</p>
            </template>

            <!-- 3. Some commands failed -->
            <template v-else-if="state === 'errors'">
                <p class="text-error">{{ $t("pidTuningImportTuneErrors") }}</p>
                <pre class="max-h-48 overflow-auto rounded bg-elevated p-2 text-xs">{{ cliErrors.join("\n") }}</pre>
            </template>
        </div>

        <template #footer>
            <template v-if="state === 'input'">
                <UButton
                    :label="$t('pidTuningImportTuneNext')"
                    size="xs"
                    :disabled="!pasted.trim()"
                    @click="readCode"
                />
            </template>
            <template v-else-if="state === 'preview'">
                <UButton
                    :label="$t('pidTuningImportTuneBack')"
                    color="neutral"
                    variant="outline"
                    size="xs"
                    @click="state = 'input'"
                />
                <UButton
                    v-if="changed.length > 0"
                    :label="$t('pidTuningImportTuneApply')"
                    size="xs"
                    :disabled="rpmMismatch && !rpmAcknowledged"
                    @click="apply"
                />
            </template>
            <template v-else-if="state === 'errors'">
                <UButton
                    :label="$t('pidTuningImportTuneDiscard')"
                    color="neutral"
                    variant="outline"
                    size="xs"
                    @click="discard"
                />
                <UButton :label="$t('pidTuningImportTuneSaveAnyway')" size="xs" @click="save" />
            </template>
            <UButton
                v-if="state !== 'applying' && state !== 'errors'"
                :label="$t('close')"
                color="neutral"
                variant="outline"
                size="xs"
                @click="onOpenChange(false)"
            />
        </template>
    </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useTranslation } from "i18next-vue";
import Dialog from "@/components/elements/Dialog.vue";
import FC from "@/js/fc";
import { useConnectionStore } from "@/stores/connection";
import {
    MIN_FC_VERSION_FOR_MSP_CLI,
    findCliSettingValue,
    isConnectionClosedError,
    isMspCliSupported,
    saveAndReconnect,
    scheduleReconnect,
    send,
    useMspCliSession,
} from "@/composables/useMspCliSession";
import {
    InvalidTuneCodeError,
    type TuneChange,
    type TuneOrigin,
    type TuneSection,
    decodeTune,
    findTuneCode,
    sameSettingValue,
    validateTune,
} from "@/js/utils/tuneShare";

const props = defineProps<{
    modelValue: boolean;
    /** A code handed over by a link; skips the paste step. */
    initialCode?: string | null;
}>();
const emit = defineEmits<{ "update:modelValue": [open: boolean] }>();

const { t } = useTranslation();
const connectionStore = useConnectionStore();
const cliSession = useMspCliSession();

type State = "input" | "reading" | "blocked" | "preview" | "applying" | "errors";

const state = ref<State>("input");
const pasted = ref("");
const errorMessage = ref("");
const origin = ref<TuneOrigin>({ firmware: "", rpmFilter: false });
const rows = ref<TuneChange[]>([]);
const skipped = ref<string[]>([]);
const rpmAcknowledged = ref(false);
const progress = ref(0);
const cliErrors = ref<string[]>([]);

const pidProfile = computed(() => FC.CONFIG.profile ?? 0);
const rateProfile = computed(() => FC.CONFIG.rateProfile ?? 0);
const currentFirmware = computed(() => FC.CONFIG.flightControllerVersion ?? "");

// A setting this firmware does not have (current === null) is not offered: `set` would only fail.
const changed = computed(() =>
    rows.value.filter((row) => row.current !== null && !sameSettingValue(row.current, row.value)),
);
const unchangedCount = computed(() => rows.value.filter((row) => sameSettingValue(row.current, row.value)).length);

/** RPM filtering is live only when the ESCs report RPM and the filter has harmonics to track. */
function isRpmFilterActive(): boolean {
    return Boolean(FC.MOTOR_CONFIG?.use_dshot_telemetry) && (FC.FILTER_CONFIG?.gyro_rpm_notch_harmonics ?? 0) > 0;
}

// Filters tuned around RPM filtering are too light without it: warn before hot motors, not after.
const rpmMismatch = computed(() => origin.value.rpmFilter && !isRpmFilterActive());

/** Different firmware lines can rename or rescale settings; the version string up to the patch level tells. */
const firmwareMismatch = computed(() => {
    const line = (version: string) => version.split(".").slice(0, 2).join(".");
    return Boolean(origin.value.firmware) && line(origin.value.firmware) !== line(currentFirmware.value);
});

function onOpenChange(open: boolean) {
    emit("update:modelValue", open);
}

function reset() {
    state.value = "input";
    pasted.value = props.initialCode ?? "";
    errorMessage.value = "";
    rows.value = [];
    skipped.value = [];
    rpmAcknowledged.value = false;
    progress.value = 0;
    cliErrors.value = [];
}

/** Why the CLI is out of reach, or null when an import can go ahead. */
function cliUnavailableReason(): string | null {
    if (connectionStore.virtualMode) {
        return t("pidTuningShareTuneVirtualMode");
    }
    if (!isMspCliSupported()) {
        return t("mspCliFirmwareTooOld", {
            required: MIN_FC_VERSION_FOR_MSP_CLI,
            current: FC.CONFIG?.flightControllerVersion || "?",
        });
    }
    return null;
}

async function readCode() {
    errorMessage.value = "";

    const code = findTuneCode(pasted.value);
    if (!code) {
        errorMessage.value = t("pidTuningImportTuneInvalid");
        return;
    }

    let decoded;
    try {
        decoded = await decodeTune(code);
    } catch (error) {
        errorMessage.value = t(
            error instanceof InvalidTuneCodeError ? "pidTuningImportTuneInvalid" : "pidTuningImportTuneDamaged",
        );
        return;
    }

    const blocked = cliUnavailableReason();
    if (blocked) {
        errorMessage.value = blocked;
        state.value = "blocked";
        return;
    }

    // Everything past this point came from someone else: only allow-listed settings go on.
    const { accepted, rejected } = validateTune(decoded.tune);
    origin.value = decoded.origin;
    skipped.value = rejected.map((setting) => setting.name);

    state.value = "reading";
    try {
        const next: TuneChange[] = [];
        for (const section of ["master", "profile", "rateprofile"] as TuneSection[]) {
            for (const setting of accepted[section]) {
                const reply = await send(`get ${setting.name}`);
                next.push({ ...setting, section, current: findCliSettingValue(reply, setting.name) });
            }
        }
        rows.value = next;
        // A setting this firmware lacks is reported, not silently dropped.
        skipped.value.push(...next.filter((row) => row.current === null).map((row) => row.name));
        state.value = "preview";
    } catch (error) {
        console.error("[ImportTune] Failed to read current values:", error);
        errorMessage.value = t("pidTuningShareTuneError", { error: String((error as Error)?.message ?? error) });
        state.value = "blocked";
    }
}

async function apply() {
    state.value = "applying";
    progress.value = 0;

    const commands = changed.value.map(({ name, value }) => `set ${name} = ${value}`);
    const result = await cliSession.runBatch(commands, {
        onProgress: ({ sent }: { sent: number }) => (progress.value = sent),
    });

    if (result.errors.length > 0) {
        cliErrors.value = result.errors.map(
            (failure: { command: string; errors: string[] }) => `${failure.command}\n  ${failure.errors.join(" ")}`,
        );
        state.value = "errors";
        return;
    }

    await save();
}

/** `save` writes EEPROM and reboots; the app reconnects on its own, as after applying a preset. */
async function save() {
    onOpenChange(false);
    await saveAndReconnect();
}

/** Leave without saving: `exit` reboots the FC, which throws away what was set in RAM. */
async function discard() {
    onOpenChange(false);
    try {
        await send("exit");
    } catch (error) {
        if (!isConnectionClosedError(error)) {
            console.error("[ImportTune] Failed to send exit:", error);
        }
    } finally {
        scheduleReconnect();
    }
}

watch(
    () => props.modelValue,
    (open) => {
        if (open) {
            reset();
            if (props.initialCode) {
                readCode();
            }
        }
    },
    { immediate: true },
);
</script>
