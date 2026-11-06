#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "website/assets/minecraft/textures/block");
const DATA_FILE = path.join(ROOT, "website/zhengzhengstudio.cn/games/minecraft3d-data.js");
const ATLAS_FILE = path.join(ROOT, "website/zhengzhengstudio.cn/games/minecraft3d-atlas.png");

const args = process.argv.slice(2);
const jarArg = args[0] === "--jar" ? args[1] : args[0];
const outArg = args.includes("--out") ? args[args.indexOf("--out") + 1] : DEFAULT_OUT;

if (!jarArg) {
    console.error("Usage: node scripts/extract_mc_1_21_11_assets.js --jar /path/to/1.21.11.jar [--out website/assets/minecraft/textures/block]");
    process.exit(1);
}

const jarPath = path.resolve(jarArg);
const outDir = path.resolve(outArg);
if (!fs.existsSync(jarPath)) {
    console.error(`Jar not found: ${jarPath}`);
    process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

function run(cmd, cmdArgs, options = {}) {
    const result = spawnSync(cmd, cmdArgs, { encoding: options.encoding || "utf8", maxBuffer: 1024 * 1024 * 200 });
    if (result.status !== 0) {
        throw new Error(`${cmd} ${cmdArgs.join(" ")}\n${result.stderr || result.stdout}`);
    }
    return result.stdout;
}

const list = run("unzip", ["-Z1", jarPath]).split(/\r?\n/).filter(Boolean);
const blockTextures = list.filter(entry => /^assets\/minecraft\/textures\/block\/.+\.png$/.test(entry));

for (let i = 0; i < blockTextures.length; i++) {
    const entry = blockTextures[i];
    const name = path.basename(entry);
    const data = spawnSync("unzip", ["-p", jarPath, entry], { encoding: "buffer", maxBuffer: 1024 * 1024 * 20 });
    if (data.status !== 0) throw new Error(`Failed to extract ${entry}`);
    fs.writeFileSync(path.join(outDir, name), data.stdout);
    if (i % 100 === 0) process.stdout.write(`Extracted ${i}/${blockTextures.length}\r`);
}

function humanName(s) {
    return s.split("_").map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

function category(s) {
    if (/ore|deepslate|stone|granite|diorite|andesite|tuff|basalt|blackstone|obsidian|bedrock|calcite|dripstone/.test(s)) return "stone";
    if (/log|planks|wood|stem|hyphae|bamboo|shelf|door|trapdoor|fence/.test(s)) return "wood";
    if (/leaves|sapling|grass|fern|flower|tulip|daisy|orchid|moss|vine|roots|bush|cactus|kelp|seagrass|coral|mushroom|azalea|petals|crop|wheat|carrot|potato|beetroot/.test(s)) return "nature";
    if (/water|ice|lava|magma|snow/.test(s)) return "fluid";
    if (/copper|iron|gold|diamond|emerald|redstone|lapis|coal|amethyst|netherite|raw_/.test(s)) return "resource";
    if (/wool|concrete|terracotta|glass|candle|shulker|glazed/.test(s)) return "color";
    if (/furnace|crafting|chest|barrel|table|lectern|beacon|anvil|cauldron|brewing|spawner|vault|crafter|hopper|dropper|dispenser|piston|command|observer|comparator|repeater|rail/.test(s)) return "utility";
    return "building";
}

function writeManifest() {
    const textures = fs.readdirSync(outDir).filter(f => f.endsWith(".png")).map(f => path.basename(f, ".png")).sort();
    const manual = [
        ["grass_block", "Grass Block", "nature", { top: "grass_block_top", side: "grass_block_side", bottom: "dirt" }],
        ["dirt", "Dirt", "nature", { all: "dirt" }],
        ["stone", "Stone", "stone", { all: "stone" }],
        ["cobblestone", "Cobblestone", "stone", { all: "cobblestone" }],
        ["sand", "Sand", "nature", { all: "sand" }],
        ["oak_log", "Oak Log", "wood", { top: "oak_log_top", bottom: "oak_log_top", side: "oak_log" }],
        ["oak_planks", "Oak Planks", "wood", { all: "oak_planks" }],
        ["oak_leaves", "Oak Leaves", "nature", { all: "oak_leaves" }, true],
        ["glass", "Glass", "color", { all: "glass" }, true],
        ["water", "Water", "fluid", { all: "water_still" }, true],
        ["lava", "Lava", "fluid", { all: "lava_still" }],
        ["bedrock", "Bedrock", "stone", { all: "bedrock" }],
        ["crafting_table", "Crafting Table", "utility", { top: "crafting_table_top", side: "crafting_table_side", front: "crafting_table_front" }],
        ["furnace", "Furnace", "utility", { top: "furnace_top", side: "furnace_side", front: "furnace_front" }],
        ["chest", "Chest", "utility", { top: "barrel_top", side: "barrel_side", front: "barrel_side" }]
    ];
    const blocks = [];
    const seen = new Set();
    for (const [id, name, cat, tex, transparent] of manual) {
        blocks.push({ id, name, category: cat, textures: tex, transparent: !!transparent });
        seen.add(id);
    }
    for (const t of textures) {
        if (seen.has(t)) continue;
        blocks.push({
            id: t,
            name: humanName(t),
            category: category(t),
            textures: { all: t },
            transparent: /glass|water|leaves|sapling|grass|fern|flower|tulip|daisy|orchid|coral|vine|roots|bush|cactus|kelp|seagrass|candle|chain|rail|door|trapdoor|bars|pane|torch|lantern|mushroom|crop|wheat|carrot|potato|beetroot|petals|fire|lava|ice/.test(t)
        });
    }
    const version = {
        id: "1.21.11",
        name: "MC3D Java Asset Catalog 1.21.11",
        assetRoot: "/assets/minecraft/textures/block/",
        generatedAt: new Date().toISOString(),
        textureCount: textures.length,
        blockCount: blocks.length
    };
    const js = `// Generated from website/assets/minecraft/textures/block for MC3D. Rebuild with scripts/extract_mc_1_21_11_assets.js.\nwindow.MC3D_VERSION = ${JSON.stringify(version, null, 2)};\nwindow.MC3D_TEXTURES = ${JSON.stringify(textures, null, 2)};\nwindow.MC3D_BLOCKS = ${JSON.stringify(blocks, null, 2)};\n`;
    fs.writeFileSync(DATA_FILE, js);
    return version;
}

function writeAtlas() {
    const code = `
from PIL import Image
from pathlib import Path
root = Path(${JSON.stringify(outDir)})
out = Path(${JSON.stringify(ATLAS_FILE)})
textures = sorted(root.glob("*.png"))
tile = 16
size = 1024
cols = size // tile
nearest = getattr(getattr(Image, "Resampling", Image), "NEAREST")
atlas = Image.new("RGBA", (size, size), (37, 37, 37, 255))
for i, p in enumerate(textures):
    x = (i % cols) * tile
    y = (i // cols) * tile
    try:
        img = Image.open(p).convert("RGBA").resize((tile, tile), nearest)
    except Exception:
        img = Image.new("RGBA", (tile, tile), (120, 80, 120, 255))
    atlas.alpha_composite(img, (x, y))
atlas.save(out, optimize=True)
`;
    const result = spawnSync("python3", ["-c", code], {
        encoding: "utf8",
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        maxBuffer: 1024 * 1024 * 20
    });
    if (result.status !== 0) {
        console.warn("Atlas generation skipped. Install Pillow for faster startup, or let the browser build the atlas.");
        console.warn(result.stderr || result.stdout);
        return false;
    }
    return true;
}

const version = writeManifest();
const atlasOk = writeAtlas();
console.log(`\nReady: ${version.textureCount} textures, ${version.blockCount} placeable blocks.`);
console.log(`Manifest: ${path.relative(ROOT, DATA_FILE)}`);
if (atlasOk) console.log(`Atlas: ${path.relative(ROOT, ATLAS_FILE)}`);
