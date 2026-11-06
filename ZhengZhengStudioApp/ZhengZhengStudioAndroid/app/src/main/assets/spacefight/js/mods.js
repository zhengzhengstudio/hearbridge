var MODS = {
    show: function() {
        var modList = document.createElement('div');
        modList.className = 'mods-screen screen';
        modList.innerHTML = [
            '<div class="mods-content">',
            '<h2>规则中心</h2>',
            '<p class="mods-note">当前版本由服务端统一计算规则，客户端模组不会改动伤害、血量或命中。</p>',
            '<button id="btn-close-mods" class="btn-secondary">关闭</button>',
            '</div>'
        ].join('');

        document.getElementById('game-container').appendChild(modList);
        document.getElementById('menu-screen').classList.add('hidden');
        document.getElementById('btn-close-mods').addEventListener('click', function() {
            document.getElementById('game-container').removeChild(modList);
            document.getElementById('menu-screen').classList.remove('hidden');
        });
    }
};
