#!/usr/bin/env python3
"""
Minecraft RCON 快速配置助手
自动修改 server.properties 启用 RCON
"""

import os
import sys
from pathlib import Path

def find_server_properties():
    possible_paths = [
        Path.cwd() / "mc_server" / "server.properties",
        Path.cwd() / "server.properties",
        Path.home() / "mc_server" / "server.properties",
    ]
    
    for path in possible_paths:
        if path.exists():
            return path
    
    return None

def enable_rcon(props_path: Path, password: str, port: int = 25575):
    with open(props_path, 'r') as f:
        lines = f.readlines()
    
    updated = {}
    new_lines = []
    
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('#') or not stripped:
            new_lines.append(line)
            continue
        
        key, _, value = stripped.partition('=')
        key = key.strip()
        
        if key == 'enable-rcon':
            new_lines.append(f'enable-rcon=true\n')
            updated['enable-rcon'] = True
        elif key == 'rcon.port':
            new_lines.append(f'rcon.port={port}\n')
            updated['rcon.port'] = True
        elif key == 'rcon.password':
            new_lines.append(f'rcon.password={password}\n')
            updated['rcon.password'] = True
        elif key == 'broadcast-rcon-to-ops':
            new_lines.append(f'broadcast-rcon-to-ops=true\n')
            updated['broadcast-rcon-to-ops'] = True
        else:
            new_lines.append(line)
    
    if 'enable-rcon' not in updated:
        new_lines.append(f'enable-rcon=true\n')
    if 'rcon.port' not in updated:
        new_lines.append(f'rcon.port={port}\n')
    if 'rcon.password' not in updated:
        new_lines.append(f'rcon.password={password}\n')
    if 'broadcast-rcon-to-ops' not in updated:
        new_lines.append(f'broadcast-rcon-to-ops=true\n')
    
    with open(props_path, 'w') as f:
        f.writelines(new_lines)
    
    return True

def main():
    print("=== Minecraft RCON 配置助手 ===\n")
    
    props_path = find_server_properties()
    
    if not props_path:
        print("未找到 server.properties 文件")
        print("请指定路径:")
        print("  python setup_rcon.py <server.properties路径>")
        custom_path = input("\n或输入路径（留空退出）: ").strip()
        if custom_path:
            props_path = Path(custom_path)
            if not props_path.exists():
                print(f"错误: 文件不存在: {props_path}")
                sys.exit(1)
        else:
            sys.exit(1)
    
    print(f"找到配置文件: {props_path}\n")
    
    import getpass
    password = getpass.getpass("设置 RCON 密码: ")
    if not password:
        print("错误: 密码不能为空")
        sys.exit(1)
    
    password_confirm = getpass.getpass("确认密码: ")
    if password != password_confirm:
        print("错误: 两次密码不一致")
        sys.exit(1)
    
    port = input("RCON 端口 [25575]: ").strip()
    port = int(port) if port else 25575
    
    print(f"\n正在配置...")
    
    try:
        enable_rcon(props_path, password, port)
        print(f"✓ 已更新 {props_path}")
        
        config_dir = Path.home()
        config_file = config_dir / ".mc_rcon_config.json"
        
        import json
        config = {
            "host": "localhost",
            "port": port,
            "password": password
        }
        
        with open(config_file, 'w') as f:
            json.dump(config, f, indent=2)
        config_file.chmod(0o600)
        print(f"✓ 已保存连接配置到 {config_file}")
        
        print("\n" + "=" * 50)
        print("配置完成！")
        print("=" * 50)
        print("\n下一步:")
        print("1. 重启 Minecraft 服务器使配置生效")
        print("2. 使用以下命令测试连接:")
        print(f"   python scripts/mc_rcon.py 'list'")
        print("\n或使用快捷命令:")
        print(f"   ./scripts/mc-cmd 'list'")
        print("\n常用命令:")
        print("  mc-cmd 'time set day'      # 设置白天")
        print("  mc-cmd 'weather clear'     # 清除天气")
        print("  mc-cmd 'give Steve diamond 64'  # 给予物品")
        print("  mc-cmd 'tp Steve 100 64 200'    # 传送玩家")
        
    except Exception as e:
        print(f"错误: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
