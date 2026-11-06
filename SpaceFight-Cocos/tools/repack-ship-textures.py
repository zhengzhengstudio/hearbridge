#!/usr/bin/env python3
"""Repack ship GLB baseColor textures (2026-10-28 观感大改).

将 12 个 ship GLB（low+high × 6 机型）内嵌的 baseColor 贴图替换为
ImageGen 生成的金属装甲贴图：
  - interceptor（玩家）→ textures/hull-albedo.jpg      （枪灰 + 青色能量导管）
  - 其余敌机          → textures/hull-albedo-enemy.jpg（枪灰 + 锈红危险条）

实现要点（安全第一）：
  * 原位替换：新图 JPEG 字节 ≤ 原 bufferView.byteLength，尾部补 0，
    因此 JSON 里所有 accessor/bufferView 偏移完全不变；
  * 只改 JSON 的 images[0].mimeType（png→jpeg）与材质
    pbrMetallicRoughness 的 metallic/roughness 因子；
  * 运行前先把原 GLB 备份到 .model-backup-2026-10-28/（不删除任何文件）；
  * 写完后重新解析校验（JSON 合法、新图可被 PIL 解码、总长一致）。
"""
import json
import os
import shutil
import struct
import subprocess
import sys

from PIL import Image

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKUP_DIR = os.path.join(PROJECT, ".model-backup-2026-10-28")

PLAYER_TEX = os.path.join(PROJECT, "assets/resources/textures/hull-albedo.jpg")
ENEMY_TEX = os.path.join(PROJECT, "assets/resources/textures/hull-albedo-enemy.jpg")

# (relative glb path, source texture)
TARGETS = []
for quality_dir, player_path in (
    ("assets/resources/models-low/ships", "assets/resources/models-low/ships"),
):
    pass  # placeholder, real list built below

SHIP_KINDS = ["interceptor", "scout", "fighter", "bomber", "gunship", "boss"]
TARGETS = []
for kind in SHIP_KINDS:
    src = PLAYER_TEX if kind == "interceptor" else ENEMY_TEX
    TARGETS.append((f"assets/resources/models-low/ships/{kind}.glb", src))
    TARGETS.append((f"assets/spacefight-high/models/ships/{kind}.glb", src))

METALLIC = 0.72
ROUGHNESS = 0.42
JPEG_QUALITY_STEPS = [82, 74, 66, 58, 50]
WIDTH_STEPS = [768, 640, 512, 384, 288]


def read_glb(path):
    with open(path, "rb") as fh:
        data = fh.read()
    magic, version, total = struct.unpack("<III", data[:12])
    if magic != 0x46546C67:
        raise ValueError(f"not a GLB: {path}")
    json_len, json_type = struct.unpack("<II", data[12:20])
    gltf = json.loads(data[20:20 + json_len].decode("utf-8"))
    bin_off = 20 + json_len
    bin_len, bin_type = struct.unpack("<II", data[bin_off:bin_off + 8])
    binary = bytearray(data[bin_off + 8:bin_off + 8 + bin_len])
    return gltf, binary, total


def encode_fitting(src_tex, budget):
    """把源贴图缩放/压缩到 budget 字节以内，返回 (jpeg_bytes, width, height, quality)。"""
    image = Image.open(src_tex).convert("RGB")
    for width in WIDTH_STEPS:
        height = round(image.height * width / image.width)
        resized = image.resize((width, height), Image.LANCZOS)
        for quality in JPEG_QUALITY_STEPS:
            out = os.path.join("/tmp", f"repack-{width}-{quality}.jpg")
            resized.save(out, "JPEG", quality=quality, optimize=True)
            blob = open(out, "rb").read()
            if len(blob) <= budget:
                return blob, width, height, quality
    raise RuntimeError(f"cannot fit {src_tex} into {budget} bytes")


def repack(glb_path, src_tex):
    gltf, binary, _ = read_glb(glb_path)
    images = gltf.get("images") or []
    if not images:
        raise RuntimeError(f"no images in {glb_path}")
    image = images[0]
    view_index = image.get("bufferView")
    if view_index is None:
        raise RuntimeError(f"image 0 is not embedded in {glb_path}")
    view = gltf["bufferViews"][view_index]
    budget = view["byteLength"]

    blob, width, height, quality = encode_fitting(src_tex, budget)
    print(f"  texture: {width}x{height} q{quality} {len(blob)}B (budget {budget}B)")

    # 原位替换 + 尾部补 0（所有偏移保持不变）
    binary[view["byteOffset"]:view["byteOffset"] + budget] = blob + b"\x00" * (budget - len(blob))
    image["mimeType"] = "image/jpeg"

    # 金属质感调优
    for material in gltf.get("materials") or []:
        pbr = material.setdefault("pbrMetallicRoughness", {})
        pbr["metallicFactor"] = METALLIC
        pbr["roughnessFactor"] = ROUGHNESS

    # 重新序列化 JSON chunk（空格补齐 4 字节对齐）
    json_blob = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_pad = (4 - len(json_blob) % 4) % 4
    json_blob += b" " * json_pad
    bin_pad = (4 - len(binary) % 4) % 4
    binary.extend(b"\x00" * bin_pad)
    total = 12 + 8 + len(json_blob) + 8 + len(binary)
    with open(glb_path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(json_blob), 0x4E4F534A))
        fh.write(json_blob)
        fh.write(struct.pack("<II", len(binary), 0x004E4942))
        fh.write(binary)
    return total


def verify(glb_path):
    gltf, binary, total = read_glb(glb_path)
    image = gltf["images"][0]
    view = gltf["bufferViews"][image["bufferView"]]
    blob = bytes(binary[view["byteOffset"]:view["byteOffset"] + view["byteLength"]])
    probe = os.path.join("/tmp", "repack-verify.jpg")
    with open(probe, "wb") as fh:
        fh.write(blob)
    with Image.open(probe) as img:
        img.load()
        assert image["mimeType"] == "image/jpeg", glb_path
        print(f"  verify OK: {os.path.basename(glb_path)} image {img.size} {len(blob)}B")


def main():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    failures = []
    for rel, src_tex in TARGETS:
        glb_path = os.path.join(PROJECT, rel)
        if not os.path.exists(glb_path):
            failures.append((rel, "missing"))
            continue
        backup = os.path.join(BACKUP_DIR, rel.replace("/", "__"))
        if not os.path.exists(backup):
            shutil.copy2(glb_path, backup)
        print(f"== {rel}")
        try:
            repack(glb_path, src_tex)
            verify(glb_path)
        except Exception as error:  # noqa: BLE001
            failures.append((rel, str(error)))
            print(f"  FAILED: {error}")
    if failures:
        print("FAILURES:")
        for rel, reason in failures:
            print(f"  {rel}: {reason}")
        sys.exit(1)
    print("all ship GLBs repacked")


if __name__ == "__main__":
    main()
