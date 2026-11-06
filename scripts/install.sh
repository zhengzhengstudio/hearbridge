#!/bin/bash
#
# 安装 Minecraft 控制器到系统
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.local/bin"

echo "=== Minecraft 控制器安装程序 ==="
echo ""

# 创建安装目录
mkdir -p "$INSTALL_DIR"

# 创建包装脚本
cat > "$INSTALL_DIR/mc-cmd" << 'EOF'
#!/bin/bash
# Minecraft RCON 命令快捷工具

PYTHON_SCRIPT="$HOME/.local/bin/mc_rcon.py"

if [ ! -f "$PYTHON_SCRIPT" ]; then
    echo "错误: 找不到 mc_rcon.py"
    exit 1
fi

python3 "$PYTHON_SCRIPT" "$@"
EOF

# 复制 Python 脚本
cp "$SCRIPT_DIR/mc_rcon.py" "$INSTALL_DIR/mc_rcon.py"
chmod +x "$INSTALL_DIR/mc-cmd" "$INSTALL_DIR/mc_rcon.py"

echo "✓ 已安装到 $INSTALL_DIR"
echo ""

# 检查 PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo "需要将 $INSTALL_DIR 添加到 PATH"
    echo ""
    
    SHELL_RC=""
    if [ -n "$ZSH_VERSION" ]; then
        SHELL_RC="$HOME/.zshrc"
    elif [ -n "$BASH_VERSION" ]; then
        SHELL_RC="$HOME/.bashrc"
    fi
    
    if [ -n "$SHELL_RC" ]; then
        echo "是否自动添加到 $SHELL_RC? [Y/n]"
        read -r answer
        if [ "$answer" != "n" ]; then
            echo "" >> "$SHELL_RC"
            echo "# Minecraft RCON 工具" >> "$SHELL_RC"
            echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$SHELL_RC"
            echo "✓ 已添加到 $SHELL_RC"
            echo ""
            echo "请运行: source $SHELL_RC"
        fi
    fi
fi

echo ""
echo "安装完成！"
echo ""
echo "使用方法:"
echo "  1. 首先配置 RCON 连接:"
echo "     mc-cmd --setup"
echo ""
echo "  2. 然后就可以发送命令了:"
echo "     mc-cmd 'time set day'"
echo "     mc-cmd 'give Steve diamond 64'"
echo ""
echo "  或者手动设置环境变量:"
echo "     export MC_RCON_HOST='localhost'"
echo "     export MC_RCON_PORT='25575'"
echo "     export MC_RCON_PASS='your_password'"
