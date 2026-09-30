import { beforeEach, describe, expect, it } from "vitest";

import { captureTuneDeeplink, hasPendingTune, takePendingTune } from "../../src/js/utils/pendingTune";

const CODE = "BFTUNE1:abc_DEF-123";

describe("captureTuneDeeplink", () => {
    beforeEach(() => {
        takePendingTune();
        window.history.replaceState(null, "", "/");
    });

    it("keeps the code and strips it from the address bar", () => {
        window.history.replaceState(null, "", `/?tune=${CODE}`);

        expect(captureTuneDeeplink()).toBe(true);
        expect(hasPendingTune()).toBe(true);
        expect(new URLSearchParams(window.location.search).has("tune")).toBe(false);
    });

    it("leaves a connect link in place for the connection to open", () => {
        window.history.replaceState(null, "", `/?connect=wss://192.168.4.1:5761&tune=${CODE}`);

        captureTuneDeeplink();

        expect(new URLSearchParams(window.location.search).get("connect")).toBe("wss://192.168.4.1:5761");
    });

    it("hands the code over once", () => {
        window.history.replaceState(null, "", `/?tune=${CODE}`);
        captureTuneDeeplink();

        expect(takePendingTune()).toBe(CODE);
        expect(takePendingTune()).toBe(null);
        expect(hasPendingTune()).toBe(false);
    });

    it("ignores a page without a tune link", () => {
        window.history.replaceState(null, "", "/?connect=wss://x:1");

        expect(captureTuneDeeplink()).toBe(false);
        expect(hasPendingTune()).toBe(false);
    });
});
