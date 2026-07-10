(function () {
    const defaults = {
        headline: '我是听障人士',
        message: '请用文字和我沟通，或放慢语速，每次只说一句。',
        contact: '未填写',
        note: '请写下时间、地点、金额和药量。'
    };
    let data = load();
    const els = {
        headline: document.getElementById('passportHeadline'),
        message: document.getElementById('passportMessage'),
        contact: document.getElementById('passportContact'),
        note: document.getElementById('passportNote'),
        headlineInput: document.getElementById('headlineInput'),
        messageInput: document.getElementById('messageInput'),
        contactInput: document.getElementById('contactInput'),
        noteInput: document.getElementById('noteInput'),
        save: document.getElementById('savePassport'),
        reset: document.getElementById('resetPassport'),
        toast: document.getElementById('toast')
    };
    render();
    els.save.addEventListener('click', save);
    els.reset.addEventListener('click', reset);

    function render() {
        els.headline.textContent = data.headline;
        els.message.textContent = data.message;
        els.contact.textContent = data.contact;
        els.note.textContent = data.note;
        els.headlineInput.value = data.headline;
        els.messageInput.value = data.message;
        els.contactInput.value = data.contact === '未填写' ? '' : data.contact;
        els.noteInput.value = data.note;
    }

    function save() {
        data = {
            headline: els.headlineInput.value.trim() || defaults.headline,
            message: els.messageInput.value.trim() || defaults.message,
            contact: els.contactInput.value.trim() || defaults.contact,
            note: els.noteInput.value.trim() || defaults.note
        };
        localStorage.setItem('hearbridge_passport_v1', JSON.stringify(data));
        render();
        toast('通行证已保存在本机。');
    }

    function reset() {
        data = { ...defaults };
        localStorage.removeItem('hearbridge_passport_v1');
        render();
        toast('已恢复默认通行证。');
    }

    function load() {
        try {
            return { ...defaults, ...JSON.parse(localStorage.getItem('hearbridge_passport_v1') || '{}') };
        } catch (error) {
            return { ...defaults };
        }
    }

    let toastTimer = null;
    function toast(message) {
        clearTimeout(toastTimer);
        els.toast.textContent = message;
        els.toast.classList.add('show');
        toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
    }
})();
