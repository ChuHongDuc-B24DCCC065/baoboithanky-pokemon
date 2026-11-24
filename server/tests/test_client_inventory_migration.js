const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const InventoryService = require("../../public/js/engine/ui/inventoryService");
const ItemCatalog = require("../../public/js/engine/ui/itemCatalog");

const emptyEquipment = { armor: null, shoes: null, accessory: null, held_item: null };

function createStorage(initialValues) {
    const storage = {
        values: { ...(initialValues || {}) },
        reads: [],
        writes: [],
        getItem(key) {
            this.reads.push(key);
            return Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : null;
        },
        setItem(key, value) {
            this.writes.push(key);
            this.values[key] = String(value);
        }
    };
    return storage;
}

function makeSnapshot(balance, items, equipment, status, result) {
    return {
        balance,
        items: { ...items },
        equipment: { ...equipment },
        migration: { status, result: result || null }
    };
}

function makeResponse(payload, status) {
    const statusCode = status || 200;
    return {
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        json: () => Promise.resolve(payload)
    };
}

function createHarness(options) {
    const opts = options || {};
    const uid = opts.uid || "client-migration-user";
    const storage = opts.storage || createStorage();
    let serverSnapshot = opts.snapshot || makeSnapshot(0, {}, emptyEquipment, "pending");
    const partySnapshot = opts.partySnapshot || {
        schemaVersion: 1,
        pokemon: [],
        activePokemonId: null,
        starterChosen: false,
        migration: { status: "completed", result: "imported" },
        revision: 0,
        updatedAt: Date.now()
    };
    let postCount = 0;
    const requests = [];
    let mapLoaded = false;
    const windowLocation = { href: "" };

    const context = vm.createContext({
        console,
        Promise,
        Object,
        Array,
        Number,
        JSON,
        Date,
        URL,
        AbortController,
        setTimeout,
        clearTimeout,
        localStorage: storage,
        window: { location: windowLocation },
        PokeItemCatalog: ItemCatalog,
        document: { getElementById: () => null },
        fetch(url, requestOptions) {
            requests.push({ url, options: requestOptions || {} });
            if (url === "/api/economy/item-catalog") {
                if (opts.catalogFailure) return Promise.resolve(makeResponse({ success: false }, 503));
                if (opts.catalogUnauthorized) return Promise.resolve(makeResponse({ success: false }, 401));
                const items = opts.catalogMetadata || Object.values(ItemCatalog.ITEMS).map((item) => ({
                    id: item.id,
                    name: item.name,
                    description: item.description,
                    shop: { ...item.shop }
                }));
                return Promise.resolve(makeResponse({ success: true, data: { items } }));
            }
            if (url === "/api/economy") {
                if (opts.unauthorized) return Promise.resolve(makeResponse({ success: false }, 401));
                return Promise.resolve(makeResponse({ success: true, data: serverSnapshot }));
            }
            if (url === "/api/party/") {
                return Promise.resolve(makeResponse({ success: true, data: partySnapshot }));
            }
            if (url === "/api/auth/csrf-token") {
                if (opts.csrfMissing) return Promise.resolve(makeResponse({ success: true, data: {} }));
                return Promise.resolve(makeResponse({ success: true, data: { csrfToken: "test-csrf-token" } }));
            }
            if (url === "/api/economy/migrate-inventory") {
                postCount++;
                const payload = JSON.parse(requestOptions.body);
                if (opts.postFailure) {
                    return Promise.resolve(makeResponse({ success: false, message: "migration failed" }, 500));
                }
                serverSnapshot = makeSnapshot(
                    serverSnapshot.balance,
                    payload.items,
                    payload.equipment,
                    "completed",
                    "imported"
                );
                if (opts.timeoutAfterCommit) {
                    return Promise.reject(new Error("simulated response timeout after commit"));
                }
                return Promise.resolve(makeResponse({
                    success: true,
                    data: {
                        ...serverSnapshot,
                        migration: { status: "completed", result: "imported" },
                        alreadyProcessed: false
                    }
                }));
            }
            return Promise.reject(new Error("Unexpected request: " + url));
        }
    });

    const sourceRoot = path.resolve(__dirname, "../..");
    vm.runInContext(fs.readFileSync(path.join(sourceRoot, "public/js/engine/index.js"), "utf8"), context);
    vm.runInContext(fs.readFileSync(path.join(sourceRoot, "public/js/engine/load.js"), "utf8"), context);
    const game = vm.runInContext("Object.create(Game.prototype)", context);
    game.speciesCatalog = [];
    game.speciesCatalogPromise = Promise.resolve([]);
    game.fetchSavedData = function () {
        this.savedData = { userId: uid };
        return Promise.resolve(this);
    };
    game.fetchMapData = function () {
        mapLoaded = true;
        return Promise.resolve(this);
    };

    return {
        uid,
        storage,
        game,
        requests,
        get postCount() { return postCount; },
        get serverSnapshot() { return serverSnapshot; },
        get mapLoaded() { return mapLoaded; },
        get redirectUrl() { return windowLocation.href; },
        async load() {
            const previousStorage = global.localStorage;
            global.localStorage = storage;
            try {
                await game.load();
            } finally {
                global.localStorage = previousStorage;
            }
        },
        createInventory() {
            return new InventoryService(uid, game.economySnapshot);
        }
    };
}

async function run() {
    const currentUid = "uid_current";
    const otherUid = "uid_other";
    const currentPrefix = "poke_proto_" + currentUid + "_";
    const otherPrefix = "poke_proto_" + otherUid + "_";
    const legacyItems = { potion_standard: 12, running_shoes: 1 };
    const legacyEquipment = { ...emptyEquipment, shoes: "running_shoes" };
    const storage = createStorage({
        [currentPrefix + "inventory"]: JSON.stringify(legacyItems),
        [currentPrefix + "equipment"]: JSON.stringify(legacyEquipment),
        [otherPrefix + "inventory"]: JSON.stringify({ potion_standard: 77 }),
        items: JSON.stringify({ potion_standard: 500 })
    });
    const pending = createHarness({ uid: currentUid, storage });
    await pending.load();
    const pendingReads = [...storage.reads];
    assert(pendingReads.includes(currentPrefix + "inventory"));
    assert(pendingReads.includes(currentPrefix + "equipment"));
    assert(!pendingReads.includes("items"), "Global legacy key must never be read");
    assert(!pendingReads.includes(otherPrefix + "inventory"), "A different UID's data must not be read");
    assert.strictEqual(pending.requests[0].url, "/api/economy/item-catalog");
    assert.strictEqual(pending.requests[0].options.credentials, "same-origin");
    assert.strictEqual(pending.requests[1].url, "/api/economy");
    assert.strictEqual(pending.requests[2].url, "/api/auth/csrf-token");
    assert.strictEqual(pending.requests[3].url, "/api/economy/migrate-inventory");
    assert.strictEqual(pending.requests[4].url, "/api/economy");
    assert.strictEqual(pending.requests[3].options.credentials, "same-origin");
    assert.strictEqual(pending.requests[3].options.headers["X-CSRF-Token"], "test-csrf-token");
    assert.deepStrictEqual(JSON.parse(pending.requests[3].options.body), {
        items: legacyItems,
        equipment: legacyEquipment
    });
    assert(pending.mapLoaded, "Map loading must wait until migration completes");
    assert.deepStrictEqual(JSON.parse(storage.values[currentPrefix + "inventory"]), legacyItems);
    assert.strictEqual(storage.writes.length, 0, "Authoritative snapshot must not be copied into legacy localStorage");
    const hydratedInventory = pending.createInventory();
    assert.strictEqual(hydratedInventory.getItemQuantity("potion_standard"), 12);
    assert.strictEqual(hydratedInventory.getItemQuantity("poke_ball"), 0);

    const baseCatalogMetadata = Object.values(ItemCatalog.ITEMS).map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        shop: { ...item.shop }
    }));
    const remoteMetadata = baseCatalogMetadata.map((item) => item.id === "potion_standard"
        ? { ...item, name: "Potion Server", shop: { ...item.shop, buyPrice: 432 } }
        : item);
    const remoteCatalogHarness = createHarness({
        uid: "uid_remote_catalog",
        catalogMetadata: remoteMetadata,
        snapshot: makeSnapshot(0, {}, emptyEquipment, "completed", "imported")
    });
    await remoteCatalogHarness.load();
    assert.strictEqual(ItemCatalog.getItem("potion_standard").name, "Potion Server");
    assert.strictEqual(ItemCatalog.getItem("potion_standard").shop.buyPrice, 432);
    assert(remoteCatalogHarness.mapLoaded, "Game loading continues after the server catalog is applied");
    assert.strictEqual(ItemCatalog.applyServerMetadata(baseCatalogMetadata), true);

    const catalogFailureStorage = createStorage({
        "poke_proto_uid_catalog_failure_inventory": JSON.stringify({ potion_standard: 2 })
    });
    const catalogFailureHarness = createHarness({ uid: "uid_catalog_failure", storage: catalogFailureStorage, catalogFailure: true });
    await assert.rejects(catalogFailureHarness.load(), (error) => error.type === "ITEM_CATALOG_LOAD_ERROR");
    assert.strictEqual(catalogFailureHarness.mapLoaded, false);
    assert.strictEqual(catalogFailureHarness.postCount, 0);
    assert.deepStrictEqual(catalogFailureStorage.reads, []);

    const catalogUnauthorizedHarness = createHarness({ uid: "uid_catalog_unauthorized", catalogUnauthorized: true });
    await assert.rejects(catalogUnauthorizedHarness.load(), (error) => error.type === "ITEM_CATALOG_LOAD_ERROR");
    assert.strictEqual(catalogUnauthorizedHarness.redirectUrl, "/login");
    assert.strictEqual(catalogUnauthorizedHarness.mapLoaded, false);

    // Missing legacy keys migrate as empty objects, never the InventoryService default bundle.
    const emptyStorage = createStorage();
    const emptyCase = createHarness({ uid: "uid_empty", storage: emptyStorage });
    await emptyCase.load();
    const emptyRequest = emptyCase.requests.find((request) => request.url === "/api/economy/migrate-inventory");
    assert.deepStrictEqual(JSON.parse(emptyRequest.options.body), { items: {}, equipment: emptyEquipment });
    const emptyInventory = emptyCase.createInventory();
    assert.strictEqual(emptyInventory.getItemQuantity("potion_standard"), 0);

    // Both completed outcomes use Firestore snapshot without reading or reposting local legacy data.
    for (const result of ["imported", "skipped_existing_data"]) {
        const completedStorage = createStorage({
            ["poke_proto_uid_" + result + "_inventory"]: JSON.stringify({ potion_standard: 66 }),
            ["poke_proto_uid_" + result + "_equipment"]: JSON.stringify(emptyEquipment)
        });
        const completedHarness = createHarness({
            uid: "uid_" + result,
            storage: completedStorage,
            snapshot: makeSnapshot(25, { super_potion: 3 }, emptyEquipment, "completed", result)
        });
        await completedHarness.load();
        assert.strictEqual(completedHarness.postCount, 0);
        assert.strictEqual(completedStorage.reads.length, 0, "Completed migration must not read legacy keys");
        assert.deepStrictEqual(JSON.parse(completedStorage.values["poke_proto_uid_" + result + "_inventory"]), { potion_standard: 66 });
        assert.strictEqual(completedHarness.createInventory().getItemQuantity("potion_standard"), 0);
        assert.strictEqual(completedHarness.createInventory().getItemQuantity("super_potion"), 3);
    }

    // A migration API failure keeps legacy storage byte-for-byte and blocks map/game release.
    const failedStorage = createStorage({
        "poke_proto_uid_failure_inventory": JSON.stringify({ potion_standard: 9 }),
        "poke_proto_uid_failure_equipment": JSON.stringify(emptyEquipment)
    });
    const failedHarness = createHarness({ uid: "uid_failure", storage: failedStorage, postFailure: true });
    const beforeFailure = JSON.stringify(failedStorage.values);
    await assert.rejects(failedHarness.load(), (error) => error.type === "ECONOMY_MIGRATION_ERROR");
    assert.strictEqual(JSON.stringify(failedStorage.values), beforeFailure);
    assert.strictEqual(failedHarness.mapLoaded, false);

    const noCsrfStorage = createStorage({
        "poke_proto_uid_no_csrf_inventory": JSON.stringify({ potion_standard: 4 }),
        "poke_proto_uid_no_csrf_equipment": JSON.stringify(emptyEquipment)
    });
    const noCsrfHarness = createHarness({ uid: "uid_no_csrf", storage: noCsrfStorage, csrfMissing: true });
    const noCsrfBefore = JSON.stringify(noCsrfStorage.values);
    await assert.rejects(noCsrfHarness.load(), (error) => error.type === "ECONOMY_MIGRATION_ERROR");
    assert.strictEqual(noCsrfHarness.postCount, 0);
    assert.strictEqual(JSON.stringify(noCsrfStorage.values), noCsrfBefore);

    const unauthorizedStorage = createStorage({
        "poke_proto_uid_unauthorized_inventory": JSON.stringify({ potion_standard: 4 })
    });
    const unauthorizedHarness = createHarness({ uid: "uid_unauthorized", storage: unauthorizedStorage, unauthorized: true });
    const unauthorizedBefore = JSON.stringify(unauthorizedStorage.values);
    await assert.rejects(unauthorizedHarness.load(), (error) => error.type === "ECONOMY_MIGRATION_ERROR");
    assert.strictEqual(unauthorizedHarness.redirectUrl, "/login");
    assert.strictEqual(unauthorizedStorage.reads.length, 0);
    assert.strictEqual(JSON.stringify(unauthorizedStorage.values), unauthorizedBefore);

    // A response timeout after commit is recovered by the next snapshot check, with no second import.
    const timeoutStorage = createStorage({
        "poke_proto_uid_timeout_inventory": JSON.stringify({ potion_standard: 8 }),
        "poke_proto_uid_timeout_equipment": JSON.stringify(emptyEquipment)
    });
    const timeoutHarness = createHarness({ uid: "uid_timeout", storage: timeoutStorage, timeoutAfterCommit: true });
    const timeoutBefore = JSON.stringify(timeoutStorage.values);
    await assert.rejects(timeoutHarness.load(), (error) => error.type === "ECONOMY_MIGRATION_ERROR");
    assert.strictEqual(JSON.stringify(timeoutStorage.values), timeoutBefore);
    await timeoutHarness.load();
    assert.strictEqual(timeoutHarness.postCount, 1);
    assert.strictEqual(timeoutHarness.requests.filter((request) => request.url === "/api/economy/migrate-inventory").length, 1);
    assert.deepStrictEqual(JSON.parse(timeoutStorage.values["poke_proto_uid_timeout_inventory"]), { potion_standard: 8 });

    console.log("Client inventory migration harness: PASS (pending, UID scoping, empty, completed/skipped, API/CSRF/auth failure, timeout retry, boot order)");
}

run().catch((error) => {
    console.error("Client inventory migration harness: FAIL", error);
    process.exitCode = 1;
});
