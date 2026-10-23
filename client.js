/**
 * dsh-cyrene 的浏览器半边 —— 在「设置 → 通用」里放两行：
 *
 *   1. 「称呼偏好」输入框（留空时用昵称；对齐上游的 nickname / callPreference 两个字段）
 *   2. 「角色扮演模式」开关
 *
 * ## 为什么开关要放在浏览器半边
 *
 * 主机半边（index.js / scene.js）读的是 `<DSH_HOME>/cyrene-scene.json`，浏览器碰不到
 * 文件系统；反过来浏览器有界面但没有主机权限。所以两边分工：
 *
 *   设置 → 通用 ──(fetch)──> /cyrene-scene-api ──> scene.js 的 writeState
 *                                                        ↓
 *                                            cyrene-scene.json
 *                                                        ↓
 *                                     scene.js 每轮注册 cyrene:scene 上下文
 *
 * 开关写的是**部署级**状态：打开之后，所有走 chat 预设的会话都按角色扮演回复，
 * 关掉就回到平常聊天。
 *
 * ## 第三件事：编辑最后一条用户消息
 *
 * 纯文本对话模式里，最后一条用户消息右上角加一个铅笔按钮（图标随包发运，见 assets/）。
 * 点开是「编辑」弹层：保存后走主机半边 `/cyrene-edit-api`，用会话的**表面替换**
 * （`surfaceOp: replace`）把「这条消息 + 它之后的一切」换成改好的文本 ——
 * 旧事件留在 append-only 日志里，只是不再进入模型看到的历史。
 *
 * 这块是**DOM 补丁**：官方对话组件没有给"消息操作"留槽位，只能认 `data-chat-flow-kind`
 * 这类稳定 data 属性往消息行里塞按钮。所以补丁是幂等的、可反复跑的（React 重渲染会
 * 把按钮冲掉，观察者会补回去）。
 *
 * 只在**纯文本对话模式**（预设 id 带 chat）里生效；其它模式不挂按钮。
 *
 * ## 组件约定
 *
 * 槽位 `settings.general.item` 是 list 槽位（`id` 保证唯一）。行内样式照抄官方设置页
 * 用的 `--dsw-alias-*` 变量，不引外部样式表 —— 客户端半边的打包里没有 CSS 通道。
 */
window.__ModuleLoader__.load({
  id: 'dsh-cyrene',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require('react');

    /** 本插件自己的 locale 命名空间（同 ns + 同语言不能重复注册）。 */
    var NS = 'dsh-cyrene';
    /** 主机接口：角色扮演模式开关。 */
    var API = '/cyrene-scene-api';
    /** 主机接口：称呼偏好 / 昵称。 */
    var ADDRESS_API = '/cyrene-nickname-api';
    /** 主机接口：编辑最后一条用户消息。 */
    var EDIT_API = '/cyrene-edit-api';
    /** 编辑按钮的图标（主机半边发运）。 */
    var EDIT_ICON = '/cyrene-edit-icon.png';
    /** 编辑器 / 按钮的 DOM 标记，避免和页面其它节点混在一起。 */
    var EDIT_BTN_CLASS = 'dsh-cyrene-edit-btn';
    var EDIT_MODAL_ATTR = 'data-dsh-cyrene-edit-modal';

    //#region 行样式（与官方设置行一致）

    var rowStyle = {
      borderBottom: '0.5px solid var(--dsw-alias-border-l2)',
      padding: '16px 0',
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      minWidth: 0
    };
    var rowTextStyle = { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: '1 1 auto' };
    var titleStyle = {
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '14px',
      fontWeight: 400,
      lineHeight: '22px'
    };
    var descStyle = {
      color: 'var(--dsw-alias-label-tertiary)',
      fontSize: '12px',
      fontWeight: 400,
      lineHeight: '18px'
    };
    var errorStyle = { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px', lineHeight: '18px' };
    var switchStyle = {
      flex: 'none',
      position: 'relative',
      width: '40px',
      height: '22px',
      borderRadius: '11px',
      border: 'none',
      padding: 0,
      cursor: 'pointer',
      background: 'var(--dsw-alias-border-l2)',
      transition: 'background 120ms ease'
    };
    var switchOnStyle = {
      background: 'var(--dsw-alias-state-business-primary)'
    };
    var knobStyle = {
      position: 'absolute',
      top: '3px',
      left: '3px',
      width: '16px',
      height: '16px',
      borderRadius: '50%',
      background: 'var(--dsw-alias-bg-module-platform)',
      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
      transition: 'left 120ms ease'
    };
    var knobOnStyle = { left: '21px' };
    var inputStyle = {
      flex: '0 1 240px',
      minWidth: '120px',
      font: 'inherit',
      fontSize: '13px',
      lineHeight: '20px',
      color: 'var(--dsw-alias-label-primary)',
      background: 'var(--dsw-alias-bg-module-platform)',
      border: '0.5px solid var(--dsw-alias-border-l2)',
      borderRadius: '8px',
      padding: '5px 10px',
      outline: 'none'
    };

    //#endregion

    /**
     * 读开关状态。
     * @returns Promise<boolean>
     */
    function fetchEnabled() {
      return fetch(API, { headers: { accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || body.ok !== true) throw new Error((body && body.error) || '读取失败');
          return body.enabled === true;
        });
    }

    /**
     * 写开关状态。
     * @param enabled - 目标状态。
     * @returns Promise<boolean> 主机确认后的状态。
     */
    function saveEnabled(enabled) {
      return fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ enabled: enabled })
      })
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || body.ok !== true) throw new Error((body && body.error) || '保存失败');
          return body.enabled === true;
        });
    }

    /**
     * 读称呼配置。
     * @returns Promise<{ nickname: string, callPreference: string, address: string }>
     */
    function fetchAddress() {
      return fetch(ADDRESS_API, { headers: { accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || body.ok !== true) throw new Error((body && body.error) || '读取失败');
          return {
            nickname: String(body.nickname || ''),
            callPreference: String(body.callPreference || ''),
            address: String(body.address || '')
          };
        });
    }

    /**
     * 写称呼偏好（或昵称）。
     * @param field - 'callPreference' / 'nickname'。
     * @param value - 新值，空串表示清除。
     * @returns Promise<{ nickname, callPreference, address }>
     */
    function saveAddress(field, value) {
      return fetch(ADDRESS_API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ field: field, value: value })
      })
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || body.ok !== true) throw new Error((body && body.error) || '保存失败');
          return {
            nickname: String(body.nickname || ''),
            callPreference: String(body.callPreference || ''),
            address: String(body.address || '')
          };
        });
    }

    //#region 编辑最后一条用户消息

    /** 会话服务（apply 里注入；没有就不挂这个功能）。 */
    var sessionsScope = null;
    /** DOM 补丁的观察者。 */
    var editObserver = null;
    /** rAF 合并：一次重渲染会触发成百上千条 mutation。 */
    var editFrame = 0;

    /**
     * 当前会话（没有就 undefined）。
     * @returns 会话对象或 undefined。
     */
    function currentSession() {
      try {
        var list = sessionsScope && sessionsScope.sessions && sessionsScope.sessions.list;
        var snapshot = list && typeof list.getSnapshot === 'function' ? list.getSnapshot() : null;
        if (!snapshot || snapshot.current === undefined) return undefined;
        return snapshot.byId[snapshot.current];
      } catch (err) {
        return undefined;
      }
    }

    /**
     * 当前会话是不是「纯文本对话模式」。只认预设 id 里带 chat 的会话 ——
     * 工作模式带 shell / 文件工具，编辑历史这种事不该在那里悄悄发生。
     * @param session - 会话对象。
     * @returns 是否允许编辑。
     */
    function isChatSession(session) {
      try {
        var preset = session && session.projectionValues ? session.projectionValues.agentPreset : undefined;
        return typeof preset === 'string' && preset.toLowerCase().indexOf('chat') !== -1;
      } catch (err) {
        return false;
      }
    }

    /**
     * 页面是浅色还是深色（决定铅笔图标要不要反色）。
     * @returns 浅色返回 true。
     */
    function isLightTheme() {
      try {
        var bg = window.getComputedStyle(document.body).backgroundColor || '';
        var m = /rgba?\(([^)]+)\)/.exec(bg);
        if (m === null) return false;
        var parts = m[1].split(',').map(function (x) { return Number(x); });
        var lum = (parts[0] * 0.299 + parts[1] * 0.587 + parts[2] * 0.114);
        return lum > 140;
      } catch (err) {
        return false;
      }
    }

    /** 往页面塞一次样式（按钮、弹层、提示条）。 */
    function injectEditStyles() {
      if (document.getElementById('dsh-cyrene-edit-style') !== null) return;
      var style = document.createElement('style');
      style.id = 'dsh-cyrene-edit-style';
      style.textContent = [
        '.' + EDIT_BTN_CLASS + '{display:inline-flex;align-items:center;justify-content:center;',
        'width:22px;height:22px;margin:0 2px;padding:0;border:none;border-radius:6px;',
        'background:transparent;cursor:pointer;opacity:.55;transition:opacity .12s ease,background .12s ease;}',
        '.' + EDIT_BTN_CLASS + ':hover{opacity:1;background:var(--dsw-alias-bg-module-platform);}',
        '.' + EDIT_BTN_CLASS + ' img{display:block;width:14px;height:14px;}',
        '.dsh-cyrene-toast{position:fixed;left:50%;bottom:72px;transform:translateX(-50%);',
        'background:rgba(24,24,24,.92);color:#fff;font-size:13px;line-height:20px;padding:8px 14px;',
        'border-radius:10px;z-index:2147483600;pointer-events:none;max-width:80vw;}'
      ].join('');
      document.head.appendChild(style);
    }

    /**
     * 底部提示条。
     * @param message - 文案。
     */
    function toast(message) {
      var el = document.createElement('div');
      el.className = 'dsh-cyrene-toast';
      el.textContent = String(message);
      document.body.appendChild(el);
      window.setTimeout(function () {
        if (el.parentNode !== null) el.parentNode.removeChild(el);
      }, 2400);
    }

    /**
     * 弹层：编辑最后一条用户消息。
     * @param text - 原文（预填）。
     * @param sessionId - 会话 id。
     */
    function openEditor(text, sessionId) {
      injectEditStyles();
      var old = document.querySelector('[' + EDIT_MODAL_ATTR + ']');
      if (old !== null && old.parentNode !== null) old.parentNode.removeChild(old);

      var overlay = document.createElement('div');
      overlay.setAttribute(EDIT_MODAL_ATTR, '');
      overlay.style.cssText = [
        'position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;',
        'background:rgba(0,0,0,.38);padding:16px;'
      ].join('');

      var panel = document.createElement('div');
      panel.style.cssText = [
        'width:min(560px,92vw);max-height:82vh;display:flex;flex-direction:column;gap:10px;',
        'background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);',
        'border:0.5px solid var(--dsw-alias-border-l2);border-radius:14px;padding:16px;',
        'box-shadow:0 18px 48px rgba(0,0,0,.32);font:inherit;'
      ].join('');

      var title = document.createElement('div');
      title.textContent = '编辑这条消息';
      title.style.cssText = 'font-size:14px;line-height:22px;font-weight:500;';

      var hint = document.createElement('div');
      hint.textContent = '保存后，这条消息之后的回复会从对话里撤回（原文仍留在会话日志里）。';
      hint.style.cssText = 'font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);';

      var area = document.createElement('textarea');
      area.value = text;
      area.rows = 6;
      area.style.cssText = [
        'width:100%;box-sizing:border-box;min-height:132px;resize:vertical;font:inherit;font-size:13px;',
        'line-height:20px;padding:10px;border-radius:10px;outline:none;',
        'background:var(--dsw-alias-bg-module);color:var(--dsw-alias-label-primary);',
        'border:0.5px solid var(--dsw-alias-border-l2);'
      ].join('');

      var footer = document.createElement('div');
      footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';
      var pill = function (label) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cssText = [
          'font:inherit;font-size:13px;line-height:20px;padding:5px 14px;border-radius:14px;cursor:pointer;',
          'border:none;background:var(--dsw-alias-bg-module);color:var(--dsw-alias-label-primary);'
        ].join('');
        return b;
      };
      var cancel = pill('取消');
      var save = pill('保存');
      save.style.background = 'var(--dsw-alias-state-business-primary)';
      save.style.color = '#fff';
      footer.appendChild(cancel);
      footer.appendChild(save);

      panel.appendChild(title);
      panel.appendChild(hint);
      panel.appendChild(area);
      panel.appendChild(footer);
      overlay.appendChild(panel);

      function close() {
        if (overlay.parentNode !== null) overlay.parentNode.removeChild(overlay);
        document.removeEventListener('keydown', onKey);
      }

      function submit() {
        var next = area.value.trim();
        if (next === '') { toast('消息不能为空'); return; }
        save.disabled = true;
        cancel.disabled = true;
        save.textContent = '保存中…';
        fetch(EDIT_API, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ sessionId: sessionId, text: next })
        })
          .then(function (res) { return res.json(); })
          .then(function (body) {
            if (!body || body.ok !== true) throw new Error((body && body.error) || '保存失败');
            close();
            toast('已修改');
            /*
             * 主机写的是表面替换，正常情况下前端会收到事件并重渲染。
             * 万一这一版前端没跟上（替换的旧节点不在可见窗口里等），
             * 1.5 秒后检查一下新文本到没到、没到就刷新一次页面。
             */
            window.setTimeout(function () {
              var rows = document.querySelectorAll('[data-chat-flow-kind="user"]');
              var lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
              var shown = lastRow !== null ? (lastRow.textContent || '') : '';
              if (shown.indexOf(next.slice(0, 24)) === -1) window.location.reload();
            }, 1500);
          })
          .catch(function (err) {
            save.disabled = false;
            cancel.disabled = false;
            save.textContent = '保存';
            toast(String((err && err.message) || err));
          });
      }

      function onKey(event) {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit(); }
      }

      cancel.addEventListener('click', close);
      save.addEventListener('click', submit);
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) close();
      });
      document.addEventListener('keydown', onKey);

      document.body.appendChild(overlay);
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    }

    /**
     * 打开编辑器：先问主机「这条能不能改」，再预填原文。
     */
    function startEdit() {
      var session = currentSession();
      if (session === undefined) { toast('先打开一个会话'); return; }
      if (!isChatSession(session)) return;
      var sessionId = String(session.id || '');
      if (sessionId === '') { toast('拿不到当前会话'); return; }
      fetch(EDIT_API + '?session=' + encodeURIComponent(sessionId), { headers: { accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || body.ok !== true) throw new Error((body && body.error) || '读取失败');
          if (body.canEdit !== true) { toast(body.reason || '这条消息现在不能编辑'); return; }
          openEditor(String(body.text || ''), sessionId);
        })
        .catch(function (err) { toast(String((err && err.message) || err)); });
    }

    /**
     * 往最后一条用户消息的操作区塞铅笔按钮（其它行清掉）。
     * 幂等：React 重渲染把按钮冲掉之后，下一轮 mutation 会补回来。
     */
    function patchEditButtons() {
      var rows = document.querySelectorAll('[data-chat-flow-kind="user"]');
      var last = rows.length > 0 ? rows[rows.length - 1] : null;
      /* 提交回显 / 待发队列里的消息还没进日志，先不给编辑入口。 */
      if (last !== null && (last.getAttribute('data-submission-echo') !== null || last.getAttribute('data-pending-steering') !== null)) {
        last = null;
      }
      var session = currentSession();
      var allowed = last !== null && isChatSession(session);

      for (var i = 0; i < rows.length; i += 1) {
        var row = rows[i];
        var owner = row === last && allowed;
        var existing = row.querySelectorAll('.' + EDIT_BTN_CLASS);
        for (var j = 0; j < existing.length; j += 1) {
          if (!owner) existing[j].parentNode.removeChild(existing[j]);
        }
        if (!owner) continue;
        /* 已经有一个就不重复塞（每轮 mutation 都会进来）。 */
        if (row.querySelector('.' + EDIT_BTN_CLASS) !== null) continue;
        var host = row.querySelector('[class*="_actions"]') || row;
        var button = document.createElement('button');
        button.type = 'button';
        button.className = EDIT_BTN_CLASS;
        button.title = '编辑这条消息';
        button.setAttribute('aria-label', '编辑这条消息');
        var img = document.createElement('img');
        img.src = EDIT_ICON;
        img.alt = '';
        if (isLightTheme()) img.style.filter = 'invert(1)';
        button.appendChild(img);
        button.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          startEdit();
        });
        host.appendChild(button);
      }
    }

    /** 合并到下一帧再补一次按钮（mutation 太密，逐条跑会卡）。 */
    function scheduleEditPatch() {
      if (editFrame !== 0) return;
      editFrame = window.requestAnimationFrame(function () {
        editFrame = 0;
        try { patchEditButtons(); } catch (err) { /* 补丁失败不该打断页面 */ }
      });
    }

    /** 装观察者：DOM 一变就补按钮（只在纯文本对话模式里真的加东西）。 */
    function watchEditDom() {
      injectEditStyles();
      scheduleEditPatch();
      if (editObserver !== null) return;
      editObserver = new MutationObserver(function () { scheduleEditPatch(); });
      editObserver.observe(document.body, { childList: true, subtree: true });
    }

    //#endregion

    /**
     * 设置行：「称呼偏好」输入框。
     * @param props - 槽位传入的 `{ t }`。
     * @returns React 元素。
     */
    function AddressRow(props) {
      var t = props && typeof props.t === 'function' ? props.t : function (key) { return key; };
      var profilePair = react.useState(null);
      var profile = profilePair[0];
      var setProfile = profilePair[1];
      var draftPair = react.useState('');
      var draft = draftPair[0];
      var setDraft = draftPair[1];
      var errorPair = react.useState('');
      var error = errorPair[0];
      var setError = errorPair[1];

      function apply(next) {
        setProfile(next);
        setDraft(next.callPreference);
      }

      react.useEffect(function () {
        var alive = true;
        fetchAddress()
          .then(function (next) { if (alive) apply(next); })
          .catch(function (err) { if (alive) setError(String((err && err.message) || err)); });
        return function () { alive = false; };
      }, []);

      function commit() {
        if (profile === null) return;
        var value = draft.trim();
        if (value === profile.callPreference) return;
        setError('');
        saveAddress('callPreference', value)
          .then(function (next) { apply(next); })
          .catch(function (err) { setError(String((err && err.message) || err)); });
      }

      var hint = profile === null
        ? t('addressLoading')
        : (profile.callPreference !== ''
          ? t('addressOn') + '「' + profile.address + '」'
          : t('addressOff') + '「' + profile.address + '」');

      return react.createElement(
        'div',
        { style: rowStyle },
        react.createElement(
          'div',
          { style: rowTextStyle },
          react.createElement('div', { style: titleStyle }, t('addressTitle')),
          react.createElement('div', { style: descStyle }, hint),
          error ? react.createElement('div', { style: errorStyle }, error) : null
        ),
        react.createElement('input', {
          type: 'text',
          value: draft,
          placeholder: t('addressPlaceholder'),
          'aria-label': t('addressTitle'),
          style: inputStyle,
          disabled: profile === null,
          onChange: function (event) { setDraft(String(event.target.value)); },
          onBlur: commit,
          onKeyDown: function (event) {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') setDraft(profile === null ? '' : profile.callPreference);
          }
        })
      );
    }

    /**
     * 设置行：「角色扮演模式」开关。
     * @param props - 槽位传入的 `{ t }`。
     * @returns React 元素。
     */
    function RoleplayRow(props) {
      var t = props && typeof props.t === 'function' ? props.t : function (key) { return key; };
      var statePair = react.useState(null); // null = 还没读到
      var enabled = statePair[0];
      var setEnabled = statePair[1];
      var busyPair = react.useState(false);
      var busy = busyPair[0];
      var setBusy = busyPair[1];
      var errorPair = react.useState('');
      var error = errorPair[0];
      var setError = errorPair[1];

      react.useEffect(function () {
        var alive = true;
        fetchEnabled()
          .then(function (value) { if (alive) setEnabled(value); })
          .catch(function (err) { if (alive) setError(String((err && err.message) || err)); });
        return function () { alive = false; };
      }, []);

      function toggle() {
        if (busy || enabled === null) return;
        var next = !enabled;
        setBusy(true);
        setError('');
        saveEnabled(next)
          .then(function (value) { setEnabled(value); })
          .catch(function (err) { setError(String((err && err.message) || err)); })
          .then(function () { setBusy(false); });
      }

      var checked = enabled === true;
      return react.createElement(
        'div',
        { style: rowStyle },
        react.createElement(
          'div',
          { style: rowTextStyle },
          react.createElement('div', { style: titleStyle }, t('title')),
          react.createElement('div', { style: descStyle }, checked ? t('onHint') : t('offHint')),
          error ? react.createElement('div', { style: errorStyle }, error) : null
        ),
        react.createElement('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': t('title'),
          title: t('title'),
          disabled: busy || enabled === null,
          style: checked ? Object.assign({}, switchStyle, switchOnStyle) : switchStyle,
          onClick: toggle
        }, react.createElement('span', {
          style: checked ? Object.assign({}, knobStyle, knobOnStyle) : knobStyle
        }))
      );
    }

    /** 需要的主机侧服务：槽位、文案、会话（编辑按钮要靠它认当前会话）。 */
    var inject = ['slots', 'locale', 'sessions'];

    /**
     * 注册文案与设置行。
     * @param ctx - 客户端插件上下文。
     */
    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, {
          zh: {
            title: '角色扮演模式',
            onHint: '已开启：每一轮回复都会带场景描述、你的动作描述与你的外貌描述（叙述＋对话）。',
            offHint: '平常聊天。开着她会按角色扮演推进：每轮都写场景、动作和样子。',
            addressTitle: '称呼偏好',
            addressPlaceholder: '例如：伙伴（留空时用昵称）',
            addressLoading: '正在读取…',
            addressOn: '她这样叫你：',
            addressOff: '留空，用昵称：',
          },
          en: {
            title: 'Role-play mode',
            onHint: 'On: every reply includes a scene description, your action, and your appearance (narration + dialogue).',
            offHint: 'Plain chat. Turn it on and each reply narrates the scene, her actions, and how she looks.',
            addressTitle: 'Preferred address',
            addressPlaceholder: 'e.g. partner (falls back to your nickname)',
            addressLoading: 'Loading…',
            addressOn: 'She calls you: ',
            addressOff: 'Empty — using your nickname: ',
          }
        });
      }, 'dsh-cyrene: locale');

      /*
       * 编辑按钮：先抓住会话服务，再挂 DOM 观察者。
       * 放在 ctx.effect 里返回清理函数 —— 插件被热替换 / 禁用时把观察者摘掉。
       */
      ctx.effect(function () {
        sessionsScope = { sessions: ctx.sessions };
        watchEditDom();
        return function () {
          sessionsScope = null;
          if (editObserver !== null) {
            editObserver.disconnect();
            editObserver = null;
          }
          if (editFrame !== 0) {
            window.cancelAnimationFrame(editFrame);
            editFrame = 0;
          }
        };
      }, 'dsh-cyrene: edit button');

      /* 称呼偏好：排在角色扮演开关之前（先定"怎么叫"，再定"怎么演"）。 */
      ctx.slots.inject('settings.general.item', function () {
        return ctx.slots.register({
          name: 'settings.general.item',
          id: 'cyrene-address',
          order: 44,
          locale: NS
        }, AddressRow);
      });

      ctx.slots.inject('settings.general.item', function () {
        return ctx.slots.register({
          name: 'settings.general.item',
          id: 'cyrene-roleplay',
          order: 45,
          locale: NS
        }, RoleplayRow);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
