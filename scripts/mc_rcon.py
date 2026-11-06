#!/usr/bin/env python3
"""
Minecraft RCON 命令行工具
用法: python mc_rcon.py "command"
     python mc_rcon.py --setup  # 交互式配置
"""

import socket
import struct
import sys
import os
import json
import getpass
from pathlib import Path

CONFIG_FILE = Path.home() / ".mc_rcon_config.json"

class MinecraftRCON:
    def __init__(self, host: str, port: int, password: str):
        self.host = host
        self.port = port
        self.password = password
        self.sock = None
    
    def connect(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.settimeout(5)
        self.sock.connect((self.host, self.port))
        response = self._send(3, self.password)
        if "invalid" in response.lower():
            raise Exception("RCON 认证失败：密码错误")
    
    def _send(self, packet_type: int, data: str) -> str:
        data_bytes = data.encode('utf-8')
        packet = struct.pack('<ii', 0, packet_type) + data_bytes + b'\x00\x00'
        length = struct.pack('<i', len(packet))
        self.sock.send(length + packet)
        
        response_length = struct.unpack('<i', self.sock.recv(4))[0]
        response_data = self.sock.recv(response_length)
        return response_data[8:-2].decode('utf-8', errors='replace')
    
    def command(self, cmd: str) -> str:
        return self._send(2, cmd)
    
    def close(self):
        if self.sock:
            self.sock.close()

def load_config() -> dict:
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_config(config: dict):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)
    CONFIG_FILE.chmod(0o600)

def interactive_setup():
    print("=== Minecraft RCON 配置 ===")
    host = input("服务器地址 [localhost]: ").strip() or "localhost"
    port = input("RCON 端口 [25575]: ").strip() or "25575"
    password = getpass.getpass("RCON 密码: ")
    
    config = {
        "host": host,
        "port": int(port),
        "password": password
    }
    
    save_config(config)
    print(f"\n配置已保存到: {CONFIG_FILE}")
    
    test = input("\n是否测试连接? [Y/n]: ").strip().lower()
    if test != 'n':
        try:
            rcon = MinecraftRCON(host, int(port), password)
            rcon.connect()
            result = rcon.command("list")
            print(f"\n连接成功！\n服务器响应: {result}")
            rcon.close()
        except Exception as e:
            print(f"\n连接失败: {e}")

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("\n常用命令示例:")
        print('  python mc_rcon.py "time set day"')
        print('  python mc_rcon.py "weather clear"')
        print('  python mc_rcon.py "give Steve diamond 64"')
        print('  python mc_rcon.py "tp Steve 100 64 200"')
        print('  python mc_rcon.py "list"')
        print('\n选项:')
        print('  --setup    交互式配置 RCON 连接')
        print('  --config   显示当前配置')
        print('  --help     显示帮助信息')
        sys.exit(1)
    
    arg = sys.argv[1]
    
    if arg == "--help":
        print(__doc__)
        sys.exit(0)
    
    if arg == "--setup":
        interactive_setup()
        sys.exit(0)
    
    if arg == "--config":
        config = load_config()
        if config:
            print("当前配置:")
            print(f"  服务器: {config.get('host', 'localhost')}")
            print(f"  端口: {config.get('port', 25575)}")
            print(f"  密码: {'*' * len(config.get('password', ''))}")
        else:
            print("尚未配置，请运行: python mc_rcon.py --setup")
        sys.exit(0)
    
    cmd = arg
    
    config = load_config()
    
    host = os.environ.get('MC_RCON_HOST', config.get('host', 'localhost'))
    port = int(os.environ.get('MC_RCON_PORT', config.get('port', 25575)))
    password = os.environ.get('MC_RCON_PASS', config.get('password', ''))
    
    if not password:
        print("错误: 未配置 RCON 密码")
        print("请运行: python mc_rcon.py --setup")
        print("或设置环境变量: export MC_RCON_PASS='your_password'")
        sys.exit(1)
    
    try:
        rcon = MinecraftRCON(host, port, password)
        rcon.connect()
        result = rcon.command(cmd)
        print(result if result else "命令已执行（无输出）")
        rcon.close()
    except socket.timeout:
        print("错误: 连接超时，请检查服务器是否运行")
        sys.exit(1)
    except ConnectionRefusedError:
        print("错误: 连接被拒绝，请检查 RCON 是否启用")
        sys.exit(1)
    except Exception as e:
        print(f"错误: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
