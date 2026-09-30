/*
 * This file is part of Betaflight.
 *
 * Betaflight is free software. You can redistribute this software
 * and/or modify this software under the terms of the GNU General
 * Public License as published by the Free Software Foundation,
 * either version 3 of the License, or (at your option) any later
 * version.
 *
 * Betaflight is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 *
 * See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public
 * License along with this software.
 *
 * If not, see <http://www.gnu.org/licenses/>.
 */

// A shared tune link — `?tune=BFTUNE1:…` — usually arrives before any aircraft is connected: a
// phone camera opens the app from a QR code. The code waits here until the PID Tuning tab can
// offer it in the Import tune dialog. Nothing is applied without the user reviewing it there.

import { ref } from "vue";
import { TUNE_LINK_PARAM, parseTuneDeeplink } from "./tuneShare";

export const pendingTuneCode = ref<string | null>(null);

/**
 * Keep a tune code from the page's `?tune=` link and strip it from the address bar, so a reload
 * or a re-shared URL does not offer the same tune again.
 * @returns true when a code was found
 */
export function captureTuneDeeplink(): boolean {
    const code = parseTuneDeeplink(window.location.search);

    if (!code) {
        return false;
    }

    try {
        const url = new URL(window.location.href);
        url.searchParams.delete(TUNE_LINK_PARAM);
        window.history.replaceState(null, "", url);
    } catch (error) {
        console.warn("[TuneLink] Could not strip tune deeplink from URL:", error);
    }

    pendingTuneCode.value = code;
    return true;
}

export function hasPendingTune(): boolean {
    return pendingTuneCode.value !== null;
}

/** Hand the waiting code over, once. */
export function takePendingTune(): string | null {
    const code = pendingTuneCode.value;
    pendingTuneCode.value = null;
    return code;
}
