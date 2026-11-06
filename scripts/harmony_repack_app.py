#!/usr/bin/env python3
"""把「已签名的 hap」按鸿蒙 app pack 的形态重新打包，供后置签名使用。

为什么需要它：本机 hvigor（DevEco 6.x）的 assembleApp 会把**未签名**的 hap 塞进 app
再只签容器，产出的 app 安装会失败；而仓库里所有已发布版本（1.0.12 / 1.0.13 / 棋牌 1.0.5、1.0.6）
的 app 内部 hap 都与独立发布的 hap **逐字节一致**。所以这里自己做容器：
  - entry-default.hap 以 ZIP_STORED 原样放入，数据起点对齐到 4096
  - pac.json / pack.info 从 hvigor 产出的 app 里原样搬过来，对齐到 4
  - 输出仍是未签名的 app，交给 hap-sign-tool 做容器签名

用法: harmony_repack_app.py --template <hvigor产出的app> --hap <已签名hap> --out <输出app>
"""
import argparse
import shutil
import tempfile
import zipfile


def padding_for(current_offset, name, align):
    """算出要让数据起点对齐到 align 所需的 extra 字段长度。"""
    base = current_offset + 30 + len(name.encode('utf-8'))
    return (align - (base % align)) % align


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--template', required=True, help='hvigor 产出的 app（提供 pac.json / pack.info）')
    parser.add_argument('--hap', required=True, help='已签名的 hap')
    parser.add_argument('--out', required=True)
    parser.add_argument('--hap-name', default='entry-default.hap')
    args = parser.parse_args()

    with zipfile.ZipFile(args.template) as src:
        side_files = [(i.filename, src.read(i.filename)) for i in src.infolist()
                      if i.filename != args.hap_name]
    if not side_files:
        raise SystemExit('模板 app 里没有找到 pac.json / pack.info')

    with tempfile.NamedTemporaryFile(suffix='.app', delete=False) as tmp:
        tmp_path = tmp.name

    with open(args.hap, 'rb') as fh:
        hap_bytes = fh.read()

    # 顺序与已发布版本保持一致：hap -> pac.json -> pack.info
    order = [(args.hap_name, hap_bytes, 4096)]
    for name, data in side_files:
        order.append((name, data, 4))

    with zipfile.ZipFile(tmp_path, 'w') as zf:
        for name, data, align in order:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = 0o644 << 16
            pad_len = padding_for(zf.fp.tell(), name, align)
            info.extra = b'\x00' * pad_len
            zf.writestr(info, data)

    with zipfile.ZipFile(tmp_path) as zf:
        for i in zf.infolist():
            data_offset = i.header_offset + 30 + len(i.filename.encode('utf-8')) + len(i.extra)
            print(f'  {i.filename:20s} size={i.file_size:8d} stored={i.compress_type == 0} '
                  f'数据偏移={data_offset} 对齐={data_offset % 4096 if i.filename.endswith(".hap") else data_offset % 4}')

    shutil.move(tmp_path, args.out)
    print(f'已生成未签名 app: {args.out}')


if __name__ == '__main__':
    main()
