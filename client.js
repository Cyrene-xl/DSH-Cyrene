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

    /** 需要的主机侧服务：槽位与文案。 */
    var inject = ['slots', 'locale'];

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
