<template>
    <Dialog :model-value="modelValue" :title="$t('pidTuningShareTuneTitle')" @update:model-value="onOpenChange">
        <div class="flex flex-col gap-3 text-sm">
            <!-- Reading the diff -->
            <div v-if="state === 'loading'" class="flex items-center gap-2">
                <UIcon name="i-lucide-loader-circle" class="animate-spin" />
                <span>{{ $t("pidTuningShareTuneReading") }}</span>
            </div>

            <!-- Cannot share: unsupported firmware, virtual mode, or a read error -->
            <p v-else-if="state === 'error'" class="text-error">{{ errorMessage }}</p>

            <!-- Nothing to share -->
            <p v-else-if="state === 'empty'">{{ $t("pidTuningShareTuneEmpty") }}</p>

            <!-- The code -->
            <template v-else-if="state === 'ready'">
                <p>{{ $t("pidTuningShareTuneIntro") }}</p>

                <!-- QR: always dark on white so phone cameras read it in either theme -->
                <div
                    class="mx-auto w-56 rounded-lg bg-white p-2 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
                    role="img"
                    :aria-label="$t('pidTuningShareTuneQrLabel')"
                    v-html="qrSvg"
                ></div>

                <UTextarea
                    :model-value="code"
                    readonly
                    autoresize
                    :rows="3"
                    class="w-full font-mono"
                    :ui="{ base: 'break-all text-xs' }"
                    @focus="selectAll"
                />

                <details>
                    <summary class="cursor-pointer text-muted">
                        {{ $t("pidTuningShareTuneCount", { count: settingCount }) }}
                    </summary>
                    <pre class="mt-2 max-h-48 overflow-auto rounded bg-elevated p-2 text-xs">{{
                        commands.join("\n")
                    }}</pre>
                </details>
            </template>
        </div>

        <template #footer>
            <UButton
                v-if="state === 'ready'"
                :label="copied ? $t('pidTuningShareTuneCopied') : $t('pidTuningShareTuneCopy')"
                :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                size="xs"
                @click="copyCode"
            />
            <UButton :label="$t('close')" color="neutral" variant="outline" size="xs" @click="onOpenChange(false)" />
        </template>
    </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { renderSVG } from "uqr";
import { useTranslation } from "i18next-vue";
import Dialog from "@/components/elements/Dialog.vue";
import FC from "@/js/fc";
import Clipboard from "@/js/Clipboard";
import { useConnectionStore } from "@/stores/connection";
import { MIN_FC_VERSION_FOR_MSP_CLI, isMspCliSupported, send } from "@/composables/useMspCliSession";
import { encodeTune, extractTune, tuneSettingCount, tuneLink, tuneToCliCommands } from "@/js/utils/tuneShare";

/** `diff` is a single CLI command, but a busy F4 can take a few seconds to print it. */
const DIFF_TIMEOUT_MS = 10000;
const COPIED_LABEL_MS = 2000;

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [open: boolean] }>();

const { t } = useTranslation();
const connectionStore = useConnectionStore();

const state = ref<"loading" | "error" | "empty" | "ready">("loading");
const errorMessage = ref("");
const code = ref("");
const commands = ref<string[]>([]);
const settingCount = ref(0);
const copied = ref(false);

/** Rendered from our own code string, never from outside input, so v-html is safe here. */
const qrSvg = computed(() => (code.value ? renderSVG(tuneLink(code.value), { ecc: "M", border: 2 }) : ""));

function onOpenChange(open: boolean) {
    emit("update:modelValue", open);
}

/** RPM filtering is live only when the ESCs report RPM and the filter has harmonics to track. */
function isRpmFilterActive(): boolean {
    return Boolean(FC.MOTOR_CONFIG?.use_dshot_telemetry) && (FC.FILTER_CONFIG?.gyro_rpm_notch_harmonics ?? 0) > 0;
}

async function readTune() {
    state.value = "loading";
    copied.value = false;

    if (connectionStore.virtualMode) {
        errorMessage.value = t("pidTuningShareTuneVirtualMode");
        state.value = "error";
        return;
    }

    if (!isMspCliSupported()) {
        errorMessage.value = t("mspCliFirmwareTooOld", {
            required: MIN_FC_VERSION_FOR_MSP_CLI,
            current: FC.CONFIG?.flightControllerVersion || "?",
        });
        state.value = "error";
        return;
    }

    try {
        const diff = await send("diff", { timeoutMs: DIFF_TIMEOUT_MS });
        const tune = extractTune(diff, { pidProfile: FC.CONFIG.profile, rateProfile: FC.CONFIG.rateProfile });

        settingCount.value = tuneSettingCount(tune);
        if (settingCount.value === 0) {
            state.value = "empty";
            return;
        }

        commands.value = tuneToCliCommands(tune);
        code.value = await encodeTune({
            origin: { firmware: FC.CONFIG.flightControllerVersion ?? "", rpmFilter: isRpmFilterActive() },
            tune,
        });
        state.value = "ready";
    } catch (error) {
        console.error("[ShareTune] Failed to read tune:", error);
        errorMessage.value = t("pidTuningShareTuneError", { error: String((error as Error)?.message ?? error) });
        state.value = "error";
    }
}

function selectAll(event: FocusEvent) {
    (event.target as HTMLTextAreaElement | null)?.select();
}

function copyCode() {
    Clipboard.writeText(
        code.value,
        () => {
            copied.value = true;
            setTimeout(() => (copied.value = false), COPIED_LABEL_MS);
        },
        (error: unknown) => console.error("[ShareTune] Copy failed:", error),
    );
}

watch(
    () => props.modelValue,
    (open) => {
        if (open) {
            readTune();
        }
    },
    { immediate: true },
);
</script>
