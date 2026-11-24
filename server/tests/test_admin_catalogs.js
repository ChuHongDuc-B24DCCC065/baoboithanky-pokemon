const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.NODE_ENV = "test";

const adminService = require("../services/adminService");
const adminController = require("../controllers/adminController");
const adminRoutes = require("../routes/adminRoutes");
const economyRoutes = require("../routes/economyRoutes");
const firebaseAuthService = require("../services/firebaseAuthService");
const firebaseConfig = require("../config/firebase");
const ItemCatalog = require("../../public/js/engine/ui/itemCatalog");
const itemCatalogService = require("../services/itemCatalogService");
const pokemonCatalogService = require("../services/pokemonCatalogService");
const { validateOrigin } = require("../middleware/authMiddleware");
const { csrfProtection } = require("../middleware/csrfMiddleware");

function makeResponse() {
    let statusCode = 200;
    let body = null;
    return {
        res: {
            status(code) { statusCode = code; return this; },
            json(value) { body = value; return this; }
        },
        get() { return { statusCode, body }; }
    };
}

async function run() {
    const originalVerify = firebaseAuthService.verifySessionCookie;
    const originalGetFirestore = firebaseConfig.getFirestore;
    const mockDocument = {
        exists: false,
        data: () => undefined
    };
    firebaseConfig.getFirestore = () => ({
        collection: () => ({ doc: () => ({ get: async () => mockDocument }) })
    });
    let passed = 0;

    async function test(name, fn) {
        await fn();
        passed += 1;
        console.log(`[PASS] ${name}`);
    }

    try {
        const speciesPath = path.join(__dirname, "../../public/res/pokemon/species.json");
        const sourceSpecies = JSON.parse(fs.readFileSync(speciesPath, "utf8"));
        const species = await adminService.getPokemonCatalog();
        const items = await adminService.getItemCatalog();

        await test("Pokémon catalog reads the existing species source and exposes management fields", () => {
            assert.strictEqual(species.length, sourceSpecies.length);
            assert.deepStrictEqual(species[0].id, sourceSpecies[0].id);
            assert.deepStrictEqual(species[0].types, sourceSpecies[0].types);
            assert.deepStrictEqual(species[0].baseStats, sourceSpecies[0].baseStats);
            assert.strictEqual(species[0].assets, undefined);
        });

        await test("Item catalog uses the existing catalog and preserves category, effect and shop metadata", () => {
            assert.strictEqual(items.length, Object.keys(ItemCatalog.ITEMS).length);
            const potion = items.find((item) => item.id === "potion_standard");
            assert.deepStrictEqual(potion.shop, ItemCatalog.getItem("potion_standard").shop);
            assert.deepStrictEqual(potion.effect, ItemCatalog.getItem("potion_standard").effect);
            assert.strictEqual(potion.category, ItemCatalog.getItem("potion_standard").category);
            assert.strictEqual(items.find((item) => item.id === "potion_standard").email, undefined);
        });

        await test("Catalog APIs return the read-only catalog payloads", async () => {
            const pokemonResponse = makeResponse();
            await adminController.getPokemonCatalog({}, pokemonResponse.res);
            assert.strictEqual(pokemonResponse.get().statusCode, 200);
            assert.strictEqual(pokemonResponse.get().body.data.pokemon.length, sourceSpecies.length);

            const itemResponse = makeResponse();
            await adminController.getItemCatalog({}, itemResponse.res);
            assert.strictEqual(itemResponse.get().statusCode, 200);
            assert.strictEqual(itemResponse.get().body.data.items.length, Object.keys(ItemCatalog.ITEMS).length);
        });

        await test("Item metadata validation rejects unknown item IDs and protected gameplay fields", async () => {
            assert.throws(
                () => itemCatalogService.validateEditableMetadata("unknown_item", { name: "X", description: "", shop: {} }),
                (error) => error.code === "ITEM_NOT_FOUND"
            );
            assert.throws(
                () => itemCatalogService.validateEditableMetadata("potion_standard", {
                    name: "Potion", description: "", shop: ItemCatalog.getItem("potion_standard").shop, effect: { amount: 999 }
                }),
                (error) => error.code === "INVALID_ITEM_METADATA"
            );
            assert.throws(
                () => itemCatalogService.validateEditableMetadata("potion_standard", {
                    name: "Potion", description: "", shop: { ...ItemCatalog.getItem("potion_standard").shop, buyPrice: 0 }
                }),
                (error) => error.code === "INVALID_ITEM_METADATA"
            );
        });

        await test("Valid metadata is persisted as an override and read back without changing the base catalog", async () => {
            const documents = new Map();
            const makeRef = (key) => ({
                path: key,
                get: async () => {
                    const value = documents.get(key);
                    return { exists: value !== undefined, data: () => value };
                }
            });
            const db = {
                collection(name) { return { doc: (id) => makeRef(name + "/" + id) }; },
                async runTransaction(callback) {
                    const writes = [];
                    const tx = {
                        get: async (ref) => {
                            const value = documents.get(ref.path);
                            return { exists: value !== undefined, data: () => value };
                        },
                        set: (ref, value) => writes.push([ref.path, value])
                    };
                    const result = await callback(tx);
                    writes.forEach(([key, value]) => documents.set(key, value));
                    return result;
                }
            };
            const baseName = ItemCatalog.getItem("potion_standard").name;
            const basePrice = ItemCatalog.getItem("potion_standard").shop.buyPrice;
            const baseClientMetadata = Object.values(ItemCatalog.ITEMS).map((item) => ({
                id: item.id,
                name: item.name,
                description: item.description,
                shop: { ...item.shop }
            }));
            firebaseConfig.getFirestore = () => db;
            const editResponse = makeResponse();
            await adminController.updateItemCatalogEntry({
                params: { itemId: "potion_standard" },
                body: {
                name: "Potion Plus",
                description: "Bản mô tả mới",
                shop: { buyable: true, buyPrice: 425, sellable: true, sellPrice: 200 }
                }
            }, editResponse.res);
            const updated = editResponse.get().body.data.item;
            const loaded = await itemCatalogService.getClientMetadata(db);
            const potion = loaded.find((item) => item.id === "potion_standard");
            assert.strictEqual(editResponse.get().statusCode, 200);
            assert.strictEqual(updated.name, "Potion Plus");
            assert.strictEqual(potion.shop.buyPrice, 425);
            assert.strictEqual(potion.description, "Bản mô tả mới");
            assert.strictEqual(ItemCatalog.getItem("potion_standard").name, baseName);
            assert.strictEqual(ItemCatalog.getItem("potion_standard").shop.buyPrice, basePrice);
            assert.strictEqual(ItemCatalog.applyServerMetadata(loaded), true);
            assert.strictEqual(ItemCatalog.getItem("potion_standard").name, "Potion Plus");
            assert.strictEqual(ItemCatalog.getItem("potion_standard").effect.amount, 20);
            assert.strictEqual(ItemCatalog.applyServerMetadata(baseClientMetadata), true);
        });

        await test("Species metadata override is persisted and merged while identity and assets remain source-owned", async () => {
            const documents = new Map();
            const makeRef = (key) => ({
                path: key,
                get: async () => {
                    const value = documents.get(key);
                    return { exists: value !== undefined, data: () => value };
                }
            });
            const db = {
                collection(name) { return { doc: (id) => makeRef(name + "/" + id) }; },
                async runTransaction(callback) {
                    const writes = [];
                    const tx = {
                        get: async (ref) => {
                            const value = documents.get(ref.path);
                            return { exists: value !== undefined, data: () => value };
                        },
                        set: (ref, value) => writes.push([ref.path, value])
                    };
                    const result = await callback(tx);
                    writes.forEach(([key, value]) => documents.set(key, value));
                    return result;
                }
            };
            const source = pokemonCatalogService.readBaseSpecies();
            const original = source[0];
            const payload = {
                name: "Bulbasaur Admin",
                types: ["GRASS", "POISON"],
                generation: 1,
                heightM: original.heightM,
                weightKg: original.weightKg,
                baseStats: { ...original.baseStats, attack: original.baseStats.attack + 1 },
                dexEntry: "Updated description"
            };
            const updated = await pokemonCatalogService.updateSpeciesMetadata(original.id, payload, db);
            const effective = await pokemonCatalogService.getEffectiveSpecies(db);
            assert.strictEqual(updated.name, payload.name);
            assert.strictEqual(effective[0].name, payload.name);
            assert.strictEqual(effective[0].baseStats.attack, payload.baseStats.attack);
            assert.strictEqual(effective[0].id, original.id);
            assert.strictEqual(effective[0].nationalDex, original.nationalDex);
            assert.deepStrictEqual(effective[0].assets, original.assets);
            assert.strictEqual(original.name, "Bulbasaur", "The base species JSON must remain unchanged in memory");
            assert.strictEqual(documents.has("systemCatalogs/pokemonSpecies"), true);
        });

        await test("Species validation rejects unknown IDs, protected identity fields, invalid types and stats", () => {
            const base = pokemonCatalogService.readBaseSpecies();
            const pokemon = base[0];
            const valid = {
                name: pokemon.name,
                types: [...pokemon.types],
                generation: pokemon.generation,
                heightM: pokemon.heightM,
                weightKg: pokemon.weightKg,
                baseStats: { ...pokemon.baseStats },
                dexEntry: pokemon.dexEntry
            };
            assert.throws(() => pokemonCatalogService.validateEditableMetadata("999", valid, base), (error) => error.code === "SPECIES_NOT_FOUND");
            assert.throws(() => pokemonCatalogService.validateEditableMetadata(pokemon.id, { ...valid, id: "999" }, base), (error) => error.code === "INVALID_SPECIES_METADATA");
            assert.throws(() => pokemonCatalogService.validateEditableMetadata(pokemon.id, { ...valid, nationalDex: 99 }, base), (error) => error.code === "INVALID_SPECIES_METADATA");
            assert.throws(() => pokemonCatalogService.validateEditableMetadata(pokemon.id, { ...valid, types: ["NOT_A_TYPE"] }, base), (error) => error.code === "INVALID_SPECIES_METADATA");
            assert.throws(() => pokemonCatalogService.validateEditableMetadata(pokemon.id, { ...valid, baseStats: { ...valid.baseStats, speed: -1 } }, base), (error) => error.code === "INVALID_SPECIES_METADATA");
        });

        await test("Both catalog routes are registered after the Admin authorization middleware", () => {
            const layers = adminRoutes.stack;
            const adminGuardIndex = layers.findIndex((layer) => layer.name === "requireAdmin");
            const pokemonIndex = layers.findIndex((layer) => layer.route && layer.route.path === "/pokemon");
            const editPokemonIndex = layers.findIndex((layer) => layer.route && layer.route.path === "/pokemon/:speciesId");
            const itemsIndex = layers.findIndex((layer) => layer.route && layer.route.path === "/items");
            const editItemIndex = layers.findIndex((layer) => layer.route && layer.route.path === "/items/:itemId");
            assert(adminGuardIndex >= 0);
            assert(pokemonIndex > adminGuardIndex);
            assert(editPokemonIndex > adminGuardIndex);
            assert(itemsIndex > adminGuardIndex);
            assert(editItemIndex > adminGuardIndex);
            assert.strictEqual(layers[editItemIndex].route.methods.patch, true);
            assert.strictEqual(layers[editItemIndex].route.stack[0].handle, validateOrigin);
            assert.strictEqual(layers[editItemIndex].route.stack[1].handle, csrfProtection);
            assert.strictEqual(layers[editPokemonIndex].route.methods.patch, true);
            assert.strictEqual(layers[editPokemonIndex].route.stack[0].handle, validateOrigin);
            assert.strictEqual(layers[editPokemonIndex].route.stack[1].handle, csrfProtection);
        });

        await test("Game Pokémon catalog API requires an authenticated session", () => {
            const route = economyRoutes.stack.find((layer) => layer.route && layer.route.path === "/pokemon-catalog");
            assert(route);
            assert.strictEqual(route.route.methods.get, true);
            assert.strictEqual(route.route.stack[0].handle, require("../middleware/authMiddleware").requireAuth);
        });

        await test("Admin UI provides an edit form with Save/Cancel and sends CSRF-authenticated metadata only", () => {
            const adminHtml = fs.readFileSync(path.join(__dirname, "../../public/admin/index.html"), "utf8");
            const adminScript = fs.readFileSync(path.join(__dirname, "../../public/admin/js/admin.js"), "utf8");
            const adminCss = fs.readFileSync(path.join(__dirname, "../../public/admin/css/admin.css"), "utf8");
            assert.match(adminHtml, /id="item-edit-form"/);
            assert.match(adminHtml, /id="btn-save-item-edit"/);
            assert.match(adminHtml, /id="btn-cancel-item-edit"/);
            assert.match(adminHtml, /id="pokemon-edit-form"/);
            assert.match(adminHtml, /id="btn-save-pokemon-edit"/);
            assert.match(adminHtml, /id="btn-cancel-pokemon-edit"/);
            assert.match(adminScript, /method:\s*"PATCH"/);
            assert.match(adminScript, /"X-CSRF-Token":\s*csrfToken/);
            assert.match(adminScript, /fetch\("\/api\/admin\/items\/" \+ encodeURIComponent\(itemId\)/);
            assert.match(adminScript, /fetch\("\/api\/admin\/pokemon\/" \+ encodeURIComponent\(speciesId\)/);
            assert.match(adminCss, /\.admin-sidebar\s*\{[^}]*position:\s*fixed/s);
            assert.match(adminCss, /\.admin-content\s*\{[^}]*overflow:\s*auto/s);
        });

        await test("Unauthenticated and regular-user requests are rejected by Admin middleware", async () => {
            const requireAdmin = require("../middleware/adminMiddleware").requireAdmin;
            const unauthReq = { headers: { cookie: "" } };
            const unauthRes = makeResponse();
            let unauthorizedNext = false;
            await requireAdmin(unauthReq, unauthRes.res, () => { unauthorizedNext = true; });
            assert.strictEqual(unauthRes.get().statusCode, 401);
            assert.strictEqual(unauthorizedNext, false);

            firebaseAuthService.verifySessionCookie = async () => ({ uid: "player-1", admin: false });
            const playerReq = { headers: { cookie: "poke.sid=player-cookie" } };
            const playerRes = makeResponse();
            let playerNext = false;
            await requireAdmin(playerReq, playerRes.res, () => { playerNext = true; });
            assert.strictEqual(playerRes.get().statusCode, 403);
            assert.strictEqual(playerNext, false);
        });

        console.log(`Admin catalog tests: ${passed} PASS, 0 FAIL`);
    } finally {
        firebaseAuthService.verifySessionCookie = originalVerify;
        firebaseConfig.getFirestore = originalGetFirestore;
    }
}

run().catch((err) => {
    console.error("Admin catalog tests failed:", err);
    process.exitCode = 1;
});
