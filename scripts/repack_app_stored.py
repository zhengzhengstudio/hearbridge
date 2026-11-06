#!/usr/bin/env python3
"""把 APP Pack 重新打包为 HarmonyOS 要求的 STORED（不压缩）结构。

AGC 上传报 991「非法软件包」的根因：用普通 zip（默认 Deflate）重打包 .app，
条目压缩方式/扩展属性与 hvigor 产物不一致。AGC 已通过的产物全部是 Stored。
"""
import sys
import zipfile

ORDER = ("entry-default.hap", "pac.json", "pack.info")


def repack(src_app: str, signed_hap: str, dst_app: str) -> None:
    with zipfile.ZipFile(src_app) as zin:
        entries = {n: zin.read(n) for n in zin.namelist()}

    hap_name = next((n for n in entries if n.endswith(".hap")), "entry-default.hap")
    entries[hap_name] = open(signed_hap, "rb").read()

    names = [n for n in ORDER if n in entries]
    names += [n for n in entries if n not in names]

    with zipfile.ZipFile(dst_app, "w", zipfile.ZIP_STORED) as zout:
        for n in names:
            info = zipfile.ZipInfo(n, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            info.create_system = 3
            info.external_attr = 0o644 << 16
            zout.writestr(info, entries[n])

    with zipfile.ZipFile(dst_app) as z:
        for i in z.infolist():
            print(f"  {i.file_size:>9}  method={i.compress_type}  {i.filename}")


if __name__ == "__main__":
    repack(sys.argv[1], sys.argv[2], sys.argv[3])
