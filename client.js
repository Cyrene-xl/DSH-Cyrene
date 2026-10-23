/**
 * dsh-cyrene 的浏览器半边 —— 只做一件事：在「设置 → 通用」里放一行
 * 「角色扮演模式」开关。
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
    /** 主机接口。 */
    var API = '/cyrene-scene-api';

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
            offHint: '平常聊天。开着她会按角色扮演推进：每轮都写场景、动作和样子。'
          },
          en: {
            title: 'Role-play mode',
            onHint: 'On: every reply includes a scene description, your action, and your appearance (narration + dialogue).',
            offHint: 'Plain chat. Turn it on and each reply narrates the scene, her actions, and how she looks.'
          }
        });
      }, 'dsh-cyrene: locale');

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
