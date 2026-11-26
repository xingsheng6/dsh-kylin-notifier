/**
 * Client half of the Kylin desktop notifier bundle.
 *
 * Two jobs:
 *
 * 1. Deep links. A notification click opens the authenticated DSH web URL with
 *    a `#session=<id>` hash. This plugin reads that hash, waits for the session
 *    catalog to become ready, then focuses the target conversation with
 *    `uiWorkspace.openSession`, and clears the hash so a later reload does not
 *    re-trigger the navigation.
 *
 * 2. The settings page. The Plugins page renders a bundle's configuration only
 *    when a client entry registers it into `plugins.bundle.config`, keyed by
 *    the bundle's package name. Nothing renders the form automatically, so this
 *    file builds it from the Host's `kylin-notifier` settings namespace using
 *    the shared primitives, the same way DSH's own settings pages do.
 *
 * This is a plain client bundle: it uses the global ModuleLoader and only the
 * services declared in `inject`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-kylin-notifier',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');
    const h = React.default.createElement;
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');

    const inject = ['slots', 'locale', 'configForms', 'uiWorkspace', 'sessions'];

    /** Host-plane settings namespace: the profile entry id of this bundle. */
    const SETTINGS_NS = 'kylin-notifier';
    // Own sidebar entry under Settings -> <this section>. A fresh id is added
    // beside the shipped sections; reusing a shipped id would replace it.
    const SECTION_ID = 'kylin-notifier';
    /** Bundle package name: the `plugins.bundle.config` slot key. */
    const BUNDLE_NAME = 'dsh-kylin-notifier';
    /** Dictionary namespace for this plugin's own copy. */
    const NS = 'kylin-notifier';

    //#region dictionaries
    const en = {
      title: 'Kylin desktop notifier',
      description: 'Shows a desktop notification when a conversation completes or needs your confirmation; clicking one opens that conversation.',
      sectionTitle: 'Notifications',
      sectionHint: 'Changes apply immediately, without restarting Harness.',
      unavailable: 'This plugin is not loaded right now, so it cannot be configured.',
      enabled: 'Enable notifications',
      enabledHint: 'Turn every desktop notification off without uninstalling the plugin.',
      notifyOnComplete: 'Notify when a conversation completes',
      notifyOnCompleteHint: 'Fires when a turn finishes normally, is aborted, fails, or hits the length limit.',
      notifyOnApproval: 'Notify when a tool needs approval',
      notifyOnApprovalHint: 'A notification appears while a command is waiting for you to allow or reject it, and is withdrawn once you decide.',
      notifyOnQuestion: 'Notify when a question needs an answer',
      notifyOnQuestionHint: 'A notification appears while the agent is waiting for you to pick an option.',
      maxPerSession: 'Notifications kept per conversation',
      maxPerSessionHint: 'How many notifications one conversation may keep on screen; older ones close automatically.',
      minIntervalSeconds: 'Minimum gap between notifications (seconds)',
      minIntervalSecondsHint: '0 means no limit. Set e.g. 30 to avoid a burst when one conversation finishes repeatedly.',
      appName: 'Source name (first line)',
      appNameHint: 'The application name the desktop shows on the notification.',
      timeoutMs: 'Dwell time (milliseconds)',
      timeoutMsHint: 'How long the card stays on screen before it slides away.',
      sound: 'Play a sound',
      renderer: 'Notification style',
      rendererHint: 'Choose how a notification is presented. The two styles are configured separately below.',
      nativeSection: 'Kylin native notifications',
      nativeNote: 'With the system notification style, the card appearance and the sound are decided by the desktop notification centre. No card options are needed — everything is handled by the system.',
      toastSection: 'macOS-style card (custom)',
      themeHint: 'Colour scheme of the drawn card. Follow the system picks light or dark from the desktop setting.',
      position: 'Popup position',
      positionHint: 'Where the macOS-style card slides in from.',
      animation: 'Entrance animation',
      animationHint: 'Elastic overshoots then bounces back; crisp slides straight in; soft fades in with a small move.',
      soundName: 'Notification sound',
      soundNameHint: '18 synthesised tones. Pick Silent to mute.',
      themeLight: 'Light',
      themeDark: 'Dark',
      themeAuto: 'Follow the system',
      icon: 'Icon name',
      iconHint: 'A freedesktop icon name such as dialog-information. Missing icons fall back to the desktop default.',
      actionLabel: 'Open button label',
      dismissLabel: 'Dismiss button label',
      actionIcon: 'Show the open button as an icon',
      actionIconHint: 'Only applies to the native style: the desktop notification shows the open button as a small icon. The toast style always uses a text button.',
      theme: 'Colour scheme',
      previewTitle: 'Live preview',
      previewHint: 'A miniature desktop; the card animates exactly like the real popup.',
      previewSummary: '项目方案讨论',
      previewBody: '会话已完成，请到 DeepSeek Harness 中查看',
      previewReplay: 'Pop up',
      previewAnimationOnly: 'Replay animation',
      soundGridTitle: 'Notification sounds',
      soundGridHint: 'Click a card to audition and select it. Silent mutes the popup.',
      overridden: 'Overridden',
      reset: 'Reset to default',
      readOnly: 'This deployment stores settings read-only.',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'The Host rejected these values; they are left here for you to fix.',
      invalidNumber: 'Enter a number, or leave the field empty to use the default.',
      soundHint: 'Play a sound together with the popup.',
      actionLabelHint: 'Leave empty for an icon-only button. Clicking the notification body or the button opens DeepSeek Harness on that conversation.',
      dismissLabelHint: 'Leave empty to add no dismiss button, because the desktop notification panel already brings its own close control. A non-empty label adds a second, text button.',
      bridgePath: 'Bridge script path (advanced)',
      bridgePathHint: 'The Python script that talks to the system notification service. Only change it when the plugin is installed outside its default location; leave empty to use the bundled copy.',
      pythonPath: 'Python interpreter (advanced)',
      pythonPathHint: 'The interpreter that runs the bridge script. Defaults to python3 and needs python3-dbus and python3-gi. Only change it for a virtualenv or a custom interpreter.',
      webAppService: 'Web app service name (advanced)',
      webAppServiceHint: 'The service used to look up the DeepSeek Harness address. Defaults to webApp; changing it wrongly breaks jump-to-conversation.',
      debug: 'Write debug logs',
      debugHint: 'Logs the session id, conversation name and target URL of every notification for troubleshooting “why did nothing pop up”. Turn off for everyday use.',
      // Attachment-style settings page
      masterTitle: 'Desktop notifications',
      masterSubtitle: 'When off, no notification pops up at all.',
      masterOn: 'On',
      masterOff: 'Off',
      timingTitle: 'When to notify',
      timingSubtitle: 'Pick the moments that should get your attention.',
      tryIt: 'Try it',
      frequencyTitle: 'How many & how often',
      frequencySubtitle: 'Keep the desktop tidy without missing anything.',
      maxShort: 'Kept per conversation',
      maxUnit: 'notices',
      gapShort: 'Minimum gap',
      gapUnit: 'sec',
      tipText: 'Click any “Try it” to send a real notification to the desktop right now.',
      styleTitle: 'Notification style',
      systemStyle: 'Kylin system',
      macStyle: 'macOS card',
      systemStyleNote: 'Appearance and sound are decided by the desktop notification centre. Colour options are unavailable in this mode.',
      testTitle: 'Test notification',
      testBody: 'This is a test from the settings page.',
      testDoneBody: 'Conversation complete — open DeepSeek Harness to review.',
      testApproveBody: 'The agent is waiting for your approval — open DeepSeek Harness.',
      testAskBody: 'The agent has a question for you — open DeepSeek Harness.',
      testSent: 'Popup sent',
      testFailed: 'Could not send — is the desktop shell running?',
    };

    const zh = {
      title: '麒麟桌面消息提醒',
      description: '对话完成或需要你确认时弹出系统通知，点击通知即可打开并定位到对应对话。',
      sectionTitle: '通知设置',
      sectionHint: '所有设置修改后立即生效，不需要重启 DeepSeek Harness。',
      unavailable: '插件当前未加载，暂时无法配置。',
      enabled: '总开关：启用桌面通知',
      enabledHint: '关闭后本插件不再弹出任何通知，但插件本身保持启用状态，随时可以再打开。',
      notifyOnComplete: '对话完成时提醒',
      notifyOnCompleteHint: '一轮对话结束时弹窗。包括四种情况：正常回复完成、被中止（你点了停止或关闭窗口）、运行出错、回复因长度上限被截断。',
      notifyOnApproval: '等待你审批时提醒',
      notifyOnApprovalHint: 'Agent 要执行需要授权的操作（例如运行 shell 命令、写系统文件）时会弹窗提醒；你审批之后，这条提醒会自动收回，不会一直留在桌面上。',
      notifyOnQuestion: '等你回答提问时提醒',
      notifyOnQuestionHint: 'Agent 向你提出选择题（要我选哪个方案、用哪个模型之类）时弹窗提醒。',
      maxPerSession: '同一条对话最多同时保留几条提醒',
      maxPerSessionHint: '上限范围 1～50。同一条对话连续结束时，桌面上的提醒会累积；超过这个数量后，插件会自动关掉最早的一条，保证你看到的永远是最新的。设为 1 表示每条对话只留最新一条。',
      minIntervalSeconds: '两次提醒的最小间隔（秒）',
      minIntervalSecondsHint: '范围 0～3600。0 表示不限制，每条都会弹。设为 30 表示同一对话 30 秒内只弹一次，适合对话频繁结束时防止刷屏。',
      appName: '通知第一行：来源名称',
      appNameHint: '桌面通知第一行显示的文字，用来表明这条提醒来自哪个应用。默认是 DeepSeek Harness，一般不需要改。',
      timeoutMs: '弹窗停留时间（毫秒）',
      timeoutMsHint: '卡片在屏幕上停留多久后自动收起；鼠标移到卡片上时会暂停倒计时。使用 native 样式时，系统仍会在约 6 秒后把通知收进通知中心，此设置对系统通知无效。',
      sound: '弹窗时播放提示音',
      soundHint: '开启后弹出提醒时会同时发出声音；关闭则静音。',
      renderer: '通知样式',
      rendererHint: '选择通知的呈现方式。两种样式分开配置，切换样式即可看到各自的设置。',
      nativeSection: '麒麟原生通知',
      nativeNote: '选择「系统通知」时，卡片的样式和提示音都由桌面通知系统决定，无需任何卡片设置——一切交给系统处理。',
      toastSection: '仿 macOS 卡片（自定义）',
      themeHint: '自绘卡片的配色。选「跟随系统」时按桌面当前的深浅色自动切换。',
      position: '弹出位置',
      positionHint: '仿 macOS 卡片从屏幕哪个位置弹出。',
      animation: '入场动效',
      animationHint: '弹性：先冲过头再回弹；干脆：直接滑入；柔和：轻微位移淡入。',
      soundName: '提示音',
      soundNameHint: '18 种合成提示音：macOS 6 种、iOS 6 种、微信 6 种。选择「静音」则不播放。',
      themeLight: '浅色',
      themeDark: '深色',
      themeAuto: '跟随系统深浅色',
      icon: '图标名称',
      iconHint: '使用系统内置的 freedesktop 图标名，例如 dialog-information（信息）、dialog-warning（警告）、dialog-question（疑问）。只支持系统图标名，不支持图片文件路径；名字写错时会退回桌面默认图标。',
      actionLabel: '「打开对话」按钮的文字',
      dismissLabel: '「关闭」按钮的文字',
      actionIcon: '把「打开对话」显示成图标按钮',
      actionIconHint: '只对 native 样式生效：系统通知上的「打开对话」显示成图标小按钮。toast 样式固定使用文字按钮。',
      actionLabelHint: '留空则显示成一个只有箭头图标的按钮。点击通知本体或这个按钮都会打开 DeepSeek Harness 并定位到对应对话。',
      dismissLabelHint: '留空则不添加关闭按钮——桌面通知面板本身已经带有关闭控件。填写文字才会额外加一个文字版的关闭按钮，它只关掉当前这一条提醒，不做任何持久化改动，下一条提醒照常弹出。',
      bridgePath: '通知桥接脚本路径（高级）',
      bridgePathHint: '负责和系统通知服务通信的 Python 脚本位置。只有把插件装到非默认路径时才需要修改；留空使用插件自带的那份。',
      pythonPath: 'Python 解释器路径（高级）',
      pythonPathHint: '运行上面那个脚本所用的 Python，默认是 python3，需要系统装有 python3-dbus 与 python3-gi。只有用虚拟环境或自定义解释器时才需要改。',
      webAppService: 'Web 服务名（高级）',
      webAppServiceHint: '用来获取 DeepSeek Harness 地址的服务名，默认 webApp，一般不需要改。改动错误会导致通知点击后无法定位到对话。',
      debug: '输出调试日志',
      debugHint: '开启后会在服务日志里打印每次通知的会话编号、会话名和跳转地址，用于排查“为什么没弹窗”。日常使用建议关闭。',
      // 附件风格设置页
      masterTitle: '桌面通知总开关',
      masterSubtitle: '关掉后不再弹出任何通知。',
      masterOn: '已开启',
      masterOff: '已关闭',
      timingTitle: '消息提醒时机',
      timingSubtitle: '选择在哪些时刻提醒你。',
      tryIt: '试一下',
      frequencyTitle: '提醒多少、多频繁',
      frequencySubtitle: '既不错过，也不打扰。',
      maxShort: '单一对话留存条数',
      maxUnit: '条',
      gapShort: '消息提醒间隔',
      gapUnit: '秒',
      tipText: '点击任意「试一下」即可立即在桌面弹出一条真实通知。',
      styleTitle: '通知样式',
      systemStyle: '麒麟系统通知',
      macStyle: '仿 macOS 卡片',
      systemStyleNote: '此样式由桌面通知系统决定外观和提示音，配色选项不可用。',
      testTitle: '测试通知',
      testBody: '这是一条来自设置页的测试通知。',
      testDoneBody: '会话已完成，请到 DeepSeek Harness 中查看',
      testApproveBody: 'Agent 正在等待你审批，请到 DeepSeek Harness 中处理',
      testAskBody: 'Agent 有一个问题等你回答，请到 DeepSeek Harness 中处理',
      testSent: '已弹出',
      testFailed: '发送失败，请确认桌面壳正在运行。',
      theme: '配色',
      previewTitle: '实时预览',
      previewHint: '迷你桌面里的卡片会按当前设置真实演示弹出动效，与实际弹窗一致。',
      previewSummary: '项目方案讨论',
      previewBody: '会话已完成，请到 DeepSeek Harness 中查看',
      previewReplay: '弹出预览',
      previewAnimationOnly: '重播动画',
      soundGridTitle: '提示音试听与选择',
      soundGridHint: '点击任意卡片试听并选中；选择「静音」则弹窗不发音。',
      overridden: '已修改',
      reset: '恢复默认值',
      readOnly: '当前部署把设置设为只读，无法修改。',
      save: '保存',
      saving: '保存中…',
      saveFailed: '保存失败：服务端拒绝了这些值，输入内容已保留，请修改后重试。',
      invalidNumber: '请输入数字，或留空表示使用默认值。',
    };

    const dictionaries = { en, zh, 'zh-CN': zh };
    //#endregion

    /**
     * Number fields: the settings model parses text through these so an empty
     * box means "use the default" and anything unparsable stays visibly wrong
     * instead of being silently dropped.
     */
    // Preset choices for the popup dwell time, in seconds.
    const TIMEOUT_CHOICES = [
      { seconds: 1, label: '1 秒', en: '1 second' },
      { seconds: 3, label: '3 秒', en: '3 seconds' },
      { seconds: 5, label: '5 秒', en: '5 seconds' },
      { seconds: 10, label: '10 秒', en: '10 seconds' },
      { seconds: 30, label: '30 秒', en: '30 seconds' },
      { seconds: 60, label: '60 秒', en: '60 seconds' },
    ];

    /** Dwell-time presets as plain value/label pairs. */
    const DWELL_OPTIONS = TIMEOUT_CHOICES.map((choice) => ({
      value: String(choice.seconds * 1000),
      label: choice.label,
      en: choice.en,
    }));

    const RENDERER_OPTIONS = [
      { value: 'toast', label: '仿 macOS（自定义设置）', en: 'macOS style (custom settings)' },
      { value: 'native', label: '系统通知（系统样式与提示音）', en: 'System notification (system style & sound)' },
    ];

    const THEME_OPTIONS = [
      { value: 'light', label: '浅色', en: 'Light' },
      { value: 'dark', label: '深色', en: 'Dark' },
      { value: 'auto', label: '跟随系统深浅色', en: 'Follow the system' },
    ];

    const POSITION_OPTIONS = [
      { value: 'top-center', label: '顶部居中', en: 'Top centre' },
      { value: 'top-right', label: '右上角横幅', en: 'Top right banner' },
      { value: 'bottom-right', label: '右下角', en: 'Bottom right' },
    ];

    const ANIMATION_OPTIONS = [
      { value: 'elastic', label: '弹性回弹（方案 A）', en: 'Elastic (A)' },
      { value: 'crisp', label: '干脆滑入（方案 B）', en: 'Crisp (B)' },
      { value: 'soft', label: '柔和淡入（方案 C）', en: 'Soft (C)' },
    ];

    // 18 synthesised tones, all in one flat list (no platform grouping).
    const SOUND_OPTIONS = [
      { value: 'none', label: '静音', en: 'Silent' },
      { value: 'glass', label: '玻璃/水晶', en: 'Glass/Crystal' },
      { value: 'morse', label: '摩斯/乒乓', en: 'Morse/Pong' },
      { value: 'ping', label: '声纳', en: 'Ping/Sonar' },
      { value: 'pop', label: '气泡', en: 'Pop/Bubble' },
      { value: 'sosumi', label: 'Sosumi', en: 'Sosumi' },
      { value: 'tink', label: '叮咚', en: 'Tink/Boop' },
      { value: 'tritone', label: '三全音', en: 'Tritone' },
      { value: 'rebound', label: '反弹', en: 'Rebound' },
      { value: 'welcome', label: '欢迎', en: 'Welcome' },
      { value: 'cheers', label: '欢呼', en: 'Cheers' },
      { value: 'pop26', label: 'Pop', en: 'Pop' },
      { value: 'bird', label: '小鸟', en: 'Bird' },
      { value: 'wxDefault', label: '默认', en: 'Default' },
      { value: 'wxCute', label: '可爱', en: 'Cute' },
      { value: 'wxAiry', label: '空灵', en: 'Airy' },
      { value: 'wxPlayful', label: '俏皮', en: 'Playful' },
      { value: 'wxCrisp', label: '清脆', en: 'Crisp' },
      { value: 'wxElegant', label: '优雅', en: 'Elegant' },
    ];

    const NUMBER_FIELDS = ['maxPerSession', 'minIntervalSeconds', 'timeoutMs'];
    const TEXT_FIELDS = ['appName', 'icon', 'actionLabel'];
    const SELECT_FIELDS = ['renderer', 'theme', 'position', 'animation', 'soundName'];
    const BOOLEAN_FIELDS = ['enabled', 'notifyOnComplete', 'notifyOnApproval', 'notifyOnQuestion', 'sound', 'actionIcon'];

    /**
     * Bridge the Host settings namespace onto the page's staged form.
     *
     * The form model owns dirty tracking, validation and the save/discard
     * round-trip; this class only projects the fields the page renders.
     */
    function createForm(scope) {
      /**
       * A boolean field. The shared primitives ship number and text helpers only,
       * so booleans get their own spec in the same shape: the model keys on
       * `field` and stages raw text, so the checkbox writes 'true' / 'false'.
       */
      const booleanSpec = (name) => ({
        field: name,
        format: (value) => (value === true ? 'true' : 'false'),
        parse: (text) => ({ kind: 'set', value: text === 'true' }),
      });

      const specs = [
        ...BOOLEAN_FIELDS.map(booleanSpec),
        ...NUMBER_FIELDS.map((name) => primitives.settingsNumberField(name)),
        ...SELECT_FIELDS.map((name) => primitives.settingsTextField(name)),
        ...TEXT_FIELDS.map((name) => primitives.settingsTextField(name)),
      ];
      const names = [...BOOLEAN_FIELDS, ...NUMBER_FIELDS, ...SELECT_FIELDS, ...TEXT_FIELDS];
      const model = new primitives.SettingsFormModel(scope, specs);

      // A checkbox needs the boolean itself; every other field is a text box and
      // renders the model's field as-is.
      const project = (name) => {
        const field = model.field(name);
        if (!BOOLEAN_FIELDS.includes(name)) return field;
        return { ...field, value: field.text === 'true' };
      };

      const store = model.bind(() => {
        const projection = { ...model.shell() };
        for (const name of names) projection[name] = project(name);
        return projection;
      });
      return { model, store };
    }

    /** One boolean row. The page's form reads the snapshot once and passes it down. */
    function checkbox(props) {
      const { state, name, t } = props;
      const field = state[name];
      const disabled = !state.writable || state.saving;
      return h(
        'label',
        { style: { display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '6px 0' } },
        h('input', {
          type: 'checkbox',
          checked: Boolean(field && field.value),
          disabled,
          // The form model stages text, so a toggle stages the same 'true' /
          // 'false' its spec parses.
          onChange: (event) => props.edit(name, event.target.checked ? 'true' : 'false'),
        }),
        h(
          'span',
          { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
          h('span', null, t(name)),
          h('span', { style: { opacity: 0.7, fontSize: '0.85em' } }, t(`${name}Hint`)),
        ),
      );
    }

    /**
     * Navigation glyph for the sidebar entry. The shell hands us
     * `{ size, active }` and keeps its own default glyph when nothing is
     * registered, so this is purely additive.
     */
    function BellIcon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 16;
      const stroke = props.active ? 'currentColor' : 'currentColor';
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          role: 'presentation',
          'aria-hidden': 'true',
          style: { display: 'block', opacity: props.active ? 1 : 0.75 },
        },
        h('path', {
          d: 'M12 3a5 5 0 0 0-5 5v3.2c0 .6-.2 1.2-.6 1.7L5 15h14l-1.4-2.1a3 3 0 0 1-.6-1.7V8a5 5 0 0 0-5-5Z',
          fill: 'none',
          stroke,
          'stroke-width': 1.6,
          'stroke-linejoin': 'round',
        }),
        h('path', {
          d: 'M10 18a2 2 0 0 0 4 0',
          fill: 'none',
          stroke,
          'stroke-width': 1.6,
          'stroke-linecap': 'round',
        }),
      );
    }

    /** True when the active locale resolves to the Chinese dictionary. */
    function isZhLocale(locale) {
      let tag = '';
      try {
        const snapshot = typeof locale.getLocale === 'function' ? locale.getLocale() : undefined;
        tag = String((snapshot && snapshot.active) || '');
      } catch {
        tag = '';
      }
      return tag === '' ? true : tag.toLowerCase().startsWith('zh');
    }

    /**
     * A dropdown for the popup dwell time. The primitives package ships no
     * select widget, so this mirrors SettingsValueField's markup: label, help
     * button, the native <select>, and the hint line underneath.
     */
    function selectField(props) {
      const { state, t, name, options: choices, onEdit, onReset, writable, saving, chinese } = props;
      const field = state[name] || {};
      const disabled = !writable || Boolean(saving);
      const id = `kylin-notifier-${name}`;
      const hintId = `${id}-hint`;
      const values = choices.map((choice) => choice.value);
      const typed = String(field.text == null ? '' : field.text).trim();
      // Fall back to the first option when the stored value is not one this
      // control can produce (e.g. an old free-text value).
      const current = values.includes(typed) ? typed : values[0];
      const options = choices.map((choice) =>
        h('option', { key: choice.value, value: choice.value },
          chinese ? choice.label : choice.en));
      return h(
        'div',
        { style: { margin: '10px 0', display: 'flex', flexDirection: 'column', gap: '4px' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          h('label', { htmlFor: id, style: { fontWeight: 500 } }, t(name)),
          field.overridden
            ? h(
                'span',
                { style: { fontSize: '0.8em', opacity: 0.7 } },
                t('overridden'),
                ' ',
                h(
                  'button',
                  {
                    type: 'button',
                    disabled,
                    onClick: () => onReset(),
                    style: { marginLeft: '4px', cursor: disabled ? 'default' : 'pointer' },
                  },
                  t('reset'),
                ),
              )
            : null,
        ),
        h(
          'select',
          {
            id,
            value: current,
            disabled,
            'aria-describedby': hintId,
            onChange: (event) => onEdit(name, event.target.value),
            style: {
              width: '100%',
              maxWidth: '320px',
              padding: '6px 8px',
              borderRadius: '6px',
              border: '1px solid rgba(128,128,128,0.45)',
              background: 'transparent',
              color: 'inherit',
              fontSize: 'inherit',
            },
          },
          options,
        ),
        h('p', { id: hintId, style: { margin: 0, fontSize: '0.85em', opacity: 0.7 } }, t(`${name}Hint`)),
      );
    }

    //#region sound engine (Web Audio, same recipes as the Electron card)
    let audioCtx = null;
    let masterGain = null;
    const ensureAudio = () => {
      if (!audioCtx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        audioCtx = new Ctor();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.6;
        masterGain.connect(audioCtx.destination);
      }
      if (audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch { /* ignore */ } }
      return audioCtx;
    };

    function tone(freq, t0, dur, opts) {
      const o = opts || {};
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime((o.vol || 0.25) * (o.master == null ? 1 : o.master), t0 + (o.attack || 0.012));
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain).connect(masterGain);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }

    /** The 18 tones, one synthesis recipe per sound name (from the 动效合集). */
    const SOUND_RECIPES = {
      glass(t) { tone(880, t, 0.6, { vol: 0.32 }); tone(1318.5, t, 0.55, { vol: 0.16 }); },
      morse(t) {
        const dt = [0, 0.16, 0.32, 0.5, 0.85, 1.2, 1.65, 1.81, 1.97];
        const dots = ['.', '.', '.', '_', '_', '_', '.', '.', '.'];
        for (let i = 0; i < 9; i++) tone(700, t + dt[i], dots[i] === '.' ? 0.09 : 0.26, { vol: 0.25 });
      },
      ping(t) { tone(1000, t, 0.28, { vol: 0.35 }); },
      pop(t) { tone(400, t, 0.12, { vol: 0.35, slideTo: 900 }); },
      sosumi(t) { tone(987.77, t, 0.14, { vol: 0.3 }); tone(740, t + 0.16, 0.5, { vol: 0.3 }); },
      tink(t) { tone(2093, t, 0.25, { vol: 0.28 }); tone(3136, t, 0.18, { vol: 0.1 }); },
      tritone(t) { [880, 1108.73, 1318.5].forEach((f, i) => tone(f, t + i * 0.1, 0.14, { vol: 0.3 })); },
      rebound(t) { [523.25, 783.99].forEach((f, i) => tone(f, t + i * 0.1, 0.2, { vol: 0.28, slideTo: f * 1.03 })); },
      welcome(t) { [659.25, 830.61, 987.77, 1318.5].forEach((f, i) => tone(f, t + i * 0.09, 0.3, { vol: 0.2 })); },
      cheers(t) { [587.33, 739.99, 880].forEach((f, i) => tone(f, t + i * 0.08, 0.24, { type: 'triangle', vol: 0.2, slideTo: f * 1.06 })); },
      pop26(t) { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.075, 0.34, { type: 'triangle', vol: 0.2, slideTo: f * 1.01 })); },
      bird(t) { [1760, 2093, 1568, 2093, 1760].forEach((f, i) => tone(f, t + i * 0.1, 0.1, { vol: 0.18, slideTo: f * 1.12 })); },
      wxDefault(t) { [880, 1108.73, 880].forEach((f, i) => tone(f, t + i * 0.11, 0.16, { vol: 0.27 })); },
      wxCute(t) { [1046.5, 1318.5, 1568].forEach((f, i) => tone(f, t + i * 0.08, 0.16, { vol: 0.2, slideTo: f * 1.05 })); },
      wxAiry(t) { [783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, t + i * 0.12, 0.7, { vol: 0.13 })); },
      wxPlayful(t) { tone(659.25, t, 0.12, { type: 'triangle', vol: 0.22, slideTo: 1318.5 }); tone(880, t + 0.16, 0.16, { type: 'triangle', vol: 0.2, slideTo: 440 }); },
      wxCrisp(t) { [1568, 2093].forEach((f, i) => tone(f, t + i * 0.07, 0.13, { vol: 0.22 })); },
      wxElegant(t) { [523.25, 659.25, 783.99].forEach((f) => tone(f, t, 0.9, { vol: 0.13 })); },
    };

    /** Play one tone. volume 0..1 scales the 0.6 master; returns false when muted/unavailable. */
    function playSound(name, volume) {
      if (!name || name === 'none' || !SOUND_RECIPES[name]) return false;
      if (!ensureAudio()) return false;
      masterGain.gain.value = Math.max(0, Math.min(1, volume == null ? 0.6 : volume));
      try { SOUND_RECIPES[name](audioCtx.currentTime); } catch { return false; }
      return true;
    }
    //#endregion

    //#region live preview: mini desktop mockup + animated card (pure CSS/JS)
    const ANIM_DURATION = { elastic: 560, crisp: 340, soft: 420 };

    /** Position of the preview card inside the mockup, mirroring showNotifyCard(). */
    function previewCardPos(position) {
      switch (position) {
        case 'top-right': return { top: 14, right: 14 };
        case 'bottom-right': return { bottom: 14, right: 14 };
        default: return { top: 14, left: '50%', transform: 'translateX(-50%)' };
      }
    }

    /** The glass card, animated with the same keyframes as notify-card.html. */
    function PreviewCard(props) {
      const { theme, animation, playKey } = props;
      const dark = theme === 'dark';
      const [visible, setVisible] = React.useState(false);
      React.useEffect(() => {
        setVisible(false);
        // retrigger the entrance animation on every playKey change
        const show = window.setTimeout(() => setVisible(true), 30);
        return () => window.clearTimeout(show);
      }, [playKey]);
      const style = {
        position: 'absolute',
        width: 300,
        borderRadius: 15,
        padding: '12px 14px',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        background: dark ? 'rgba(44,44,46,0.86)' : 'rgba(255,255,255,0.88)',
        color: dark ? '#f2f2f7' : '#1d1d1f',
        boxShadow: dark
          ? 'inset 0 1px 0 rgba(255,255,255,0.18), inset 0 0 0 1px rgba(255,255,255,0.12)'
          : 'inset 0 1px 0 rgba(255,255,255,0.85), inset 0 0 0 1px rgba(255,255,255,0.28)',
        animation: visible ? `kylin-preview-${animation} ${ANIM_DURATION[animation] || 560}ms cubic-bezier(.2,.9,.25,1.05) both` : 'none',
        opacity: visible ? undefined : 0,
        ...previewCardPos(props.position),
      };
      return h('div', { style, className: 'kylin-preview-card' },
        h('div', {
          style: {
            width: 36, height: 36, borderRadius: 9, flexShrink: 0,
            background: 'linear-gradient(160deg,#3a3a3c,#16161a)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          },
        },
        h('svg', { width: 22, height: 22, viewBox: '0 0 24 24' },
          h('path', {
            d: 'M12 3c2.8 0 4.7 1.5 4.7 3.9 0 2.6-2.3 4.4-5 4.4-.5 0-1 0-1.5-.1l-2.6 1.8.4-2.4C6.6 9.6 5.6 8.4 5.6 6.9 5.6 4.5 8.2 3 12 3Z',
            fill: '#fff',
          }),
          h('path', { d: 'M7.5 13.6 6 17l2.7-1.2', fill: '#fff' }),
        )),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } },
            h('span', { style: { fontSize: 10, fontWeight: 700, color: dark ? '#a1a1a6' : '#6e6e73' } }, 'DeepSeek Harness'),
            h('span', { style: { fontSize: 10, color: dark ? '#636366' : '#8e8e93' } }, props.chinese ? '现在' : 'now'),
          ),
          h('div', { style: { fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
            props.summary),
          h('div', { style: { fontSize: 11, opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
            props.body),
        ),
      );
    }

    /** A miniature desktop backdrop; the card animates inside it. */
    function PreviewStage(props) {
      const position = props.position || 'top-center';
      const align = position === 'top-center' ? 'flex-start' : position === 'top-right' ? 'flex-start' : 'flex-end';
      return h('div', {
        style: {
          position: 'relative', overflow: 'hidden', height: 190,
          borderRadius: 12, marginTop: 10,
          background: 'linear-gradient(135deg,#5b6ee1 0%,#8a63d2 38%,#c65f9e 70%,#e08a56 100%)',
        },
      },
      // faux desktop: menu bar + a window silhouette
      h('div', { style: { position: 'absolute', top: 0, left: 0, right: 0, height: 18, background: 'rgba(0,0,0,0.28)', display: 'flex', alignItems: 'center', paddingLeft: 8 } },
        h('span', { style: { color: 'rgba(255,255,255,0.85)', fontSize: 9, fontWeight: 600 } }, props.chinese ? '访达  文件  编辑' : 'Finder  File  Edit'),
      ),
      h('div', { style: { position: 'absolute', left: '12%', top: 34, width: '55%', height: 110, borderRadius: 8, background: 'rgba(255,255,255,0.16)', boxShadow: '0 8px 24px rgba(0,0,0,0.25)' } },
        h('div', { style: { height: 14, borderRadius: '8px 8px 0 0', background: 'rgba(255,255,255,0.22)' } }),
        h('div', { style: { margin: '10px 12px', height: 6, width: '70%', borderRadius: 3, background: 'rgba(255,255,255,0.30)' } }),
        h('div', { style: { margin: '8px 12px', height: 6, width: '50%', borderRadius: 3, background: 'rgba(255,255,255,0.22)' } }),
      ),
      // the animated card
      h('div', {
        style: {
          position: 'absolute', left: 0, right: 0,
          ...(position === 'bottom-right' ? { bottom: 0 } : { top: 22 }),
          display: 'flex', justifyContent: align === 'flex-end' ? 'flex-end' : 'center',
          padding: position === 'top-center' ? '0 14px' : 14,
          pointerEvents: 'none',
        },
      },
        h(PreviewCard, { ...props, position }),
      ));
    }
    //#endregion

    //#region controls: segmented buttons, action buttons, sound grid
    const BLUE = '#0a84ff';

    /** Segmented control (like macOS): a row of pill buttons, one active. */
    function Segmented(props) {
      const { options, value, onChange, disabled } = props;
      return h('div', {
        style: {
          display: 'inline-flex', borderRadius: 9, padding: 2,
          background: 'rgba(128,128,128,0.18)', gap: 2,
        },
      },
        options.map((opt) => h('button', {
          key: opt.value,
          type: 'button',
          disabled: Boolean(disabled),
          onClick: () => onChange(opt.value),
          style: {
            border: 'none', cursor: disabled ? 'default' : 'pointer',
            borderRadius: 7, padding: '5px 12px', fontSize: '0.9em',
            fontWeight: value === opt.value ? 600 : 400,
            background: value === opt.value ? BLUE : 'transparent',
            color: value === opt.value ? '#fff' : 'inherit',
            transition: 'background 120ms ease',
          },
        }, props.chinese ? opt.label : opt.en)),
      );
    }

    /** Primary blue pill button with an optional glyph. */
    function ActionButton(props) {
      return h('button', {
        type: 'button',
        disabled: props.disabled,
        onClick: props.onClick,
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 6,
          border: 'none', cursor: props.disabled ? 'default' : 'pointer',
          borderRadius: 9, padding: props.primary ? '8px 18px' : '7px 14px',
          fontSize: '0.95em', fontWeight: props.primary ? 600 : 400,
          background: props.primary ? BLUE : 'rgba(128,128,128,0.18)',
          color: props.primary ? '#fff' : 'inherit',
        },
      }, props.children);
    }

    /** Control strip row: label on the left, control on the right. */
    function ControlRow(props) {
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '8px 0' } },
        h('span', { style: { width: 120, fontWeight: 500, fontSize: '0.9em' } }, props.label),
        h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } }, props.children),
      );
    }
    //#endregion

    //#region sound grid (single flat list — no platform grouping)
    const ALL_SOUND_NAMES = SOUND_OPTIONS.filter((o) => o.value !== 'none').map((o) => o.value);
    const SOUND_LABELS = {
      glass: ['玻璃/水晶', 'Glass/Crystal'], morse: ['摩斯/乒乓', 'Morse/Pong'],
      ping: ['声纳', 'Ping/Sonar'], pop: ['气泡', 'Pop/Bubble'],
      sosumi: ['Sosumi', 'Sosumi'], tink: ['叮咚', 'Tink/Boop'],
      tritone: ['三全音', 'Tritone'], rebound: ['反弹', 'Rebound'],
      welcome: ['欢迎', 'Welcome'], cheers: ['欢呼', 'Cheers'],
      pop26: ['Pop', 'Pop'], bird: ['小鸟', 'Bird'],
      wxDefault: ['默认', 'Default'], wxCute: ['可爱', 'Cute'],
      wxAiry: ['空灵', 'Airy'], wxPlayful: ['俏皮', 'Playful'],
      wxCrisp: ['清脆', 'Crisp'], wxElegant: ['优雅', 'Elegant'],
    };

    function SoundCard(props) {
      const { name, chinese, selected, disabled, onSelect, onPlay, playing } = props;
      const [zh, en] = SOUND_LABELS[name] || [name, name];
      return h('div', {
        onClick: disabled ? undefined : onSelect,
        style: {
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px', borderRadius: 12, cursor: disabled ? 'default' : 'pointer',
          background: selected ? 'rgba(10,132,255,0.10)' : 'rgba(128,128,128,0.10)',
          boxShadow: selected ? 'inset 0 0 0 1.5px ' + BLUE : 'inset 0 0 0 1px rgba(128,128,128,0.25)',
        },
      },
        h('button', {
          type: 'button', disabled,
          onClick: (event) => { event.stopPropagation(); onPlay(name); },
          style: {
            width: 34, height: 34, borderRadius: '50%', border: 'none', flexShrink: 0,
            background: playing ? '#34c759' : BLUE, color: '#fff', cursor: disabled ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
          },
          'aria-label': name,
        }, playing ? '■' : '▶'),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 } },
          h('span', { style: { fontWeight: 600, fontSize: '0.92em' } }, chinese ? zh : en),
          h('span', { style: { fontSize: '0.8em', opacity: 0.65 } }, name),
        ),
      );
    }

    function SoundGrid(props) {
      const { state, chinese, disabled, current, onPick } = props;
      const [playing, setPlaying] = React.useState('');
      const play = (name) => {
        if (!playSound(name, 0.6)) return;
        setPlaying(name);
        window.setTimeout(() => setPlaying((cur) => (cur === name ? '' : cur)), 1500);
      };
      return h('div', {
        style: { marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 8 },
      }, ALL_SOUND_NAMES.map((name) => h(SoundCard, {
        key: name, name, chinese, disabled,
        selected: current === name,
        playing: playing === name,
        onPlay: play,
        onSelect: () => onPick(name),
      })));
    }
    //#endregion

    //#region preview keyframes (mirror notify-card.html)
    const PREVIEW_CSS = `
      @keyframes kylin-preview-elastic {
        0% { transform: var(--ky-in); opacity: 0; }
        55% { transform: var(--ky-over); opacity: 1; }
        75% { transform: var(--ky-back1); }
        90% { transform: var(--ky-back2); }
        100% { transform: var(--ky-end); opacity: 1; }
      }
      @keyframes kylin-preview-crisp {
        from { transform: var(--ky-in); opacity: 0; }
        to { transform: var(--ky-end); opacity: 1; }
      }
      @keyframes kylin-preview-soft {
        from { transform: var(--ky-in-soft); opacity: 0; }
        to { transform: var(--ky-end); opacity: 1; }
      }
    `;
    // Entrance offsets per position (mirror the Electron card's keyframes).
    const PREVIEW_IN = {
      'top-center': { in: 'translateX(-50%) translateY(-96px)', over: 'translateX(-50%) translateY(9px)', back1: 'translateX(-50%) translateY(-3px)', back2: 'translateX(-50%) translateY(0px)', end: 'translateX(-50%) translateY(0)', 'in-soft': 'translateX(-50%) translateY(-22px)' },
      'top-right': { in: 'translateX(110%)', over: 'translateX(-10px)', back1: 'translateX(3px)', back2: 'translateX(0)', end: 'translateX(0)', 'in-soft': 'translateX(26px)' },
      'bottom-right': { in: 'translate(110%, 26px)', over: 'translate(-10px, 0)', back1: 'translate(3px, 0)', back2: 'translate(0, 0)', end: 'translate(0, 0)', 'in-soft': 'translate(26px, 8px)' },
    };
    /** Set the CSS variables on a card element per position. */
    function applyPreviewVars(el, position) {
      if (!el) return;
      const vars = PREVIEW_IN[position] || PREVIEW_IN['top-center'];
      for (const key of ['in', 'over', 'back1', 'back2', 'end', 'in-soft']) {
        el.style.setProperty(`--ky-${key}`, vars[key]);
      }
    }
    //#endregion

    /**
     * Trigger a REAL desktop popup through the Host's same-origin settings
     * endpoint. The browser cannot reach the Electron shell directly, but the
     * Host plugin can, so the "Try it" buttons ask the Host to send one.
     */
    function sendTestPopup(summary, body) {
      try {
        return fetch('/api/kylin-notifier/settings?action=test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ summary, body }),
        }).then((res) => res.ok ? res.json() : { ok: false }).then((data) => Boolean(data && data.ok))
          .catch(() => false);
      } catch {
        return Promise.resolve(false);
      }
    }

    /** Colored glyph for each "when to notify" row. */
    function RowIcon(props) {
      const colors = { done: '#34c759', approve: '#ff9f0a', ask: '#af52de' };
      const paths = {
        done: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 14.5-4-4 1.4-1.4 2.6 2.6 5.6-5.6L18 9.5l-7 7Z',
        approve: 'M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm-1 13-3-3 1.4-1.4L11 12.2l4.6-4.6L17 9l-6 6Z',
        ask: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm1.8-6.1-.9.9c-.7.7-1.2 1.2-1.2 2.2h-1.4v-.4c0-.8.5-1.4 1.2-2.1l1.2-1.2c.4-.4.6-.8.6-1.3a2 2 0 0 0-4 0H8.6a3.4 3.4 0 0 1 6.8 0c0 .7-.3 1.3-.8 1.9Z',
      };
      return h('svg', { width: 26, height: 26, viewBox: '0 0 24 24', style: { flexShrink: 0 } },
        h('path', { d: paths[props.kind] || paths.done, fill: colors[props.kind] || colors.done }));
    }

    /** A large macOS-style switch, used for the master toggle. */
    function BigSwitch(props) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': Boolean(props.on),
        disabled: props.disabled,
        onClick: props.onClick,
        style: {
          width: 50, height: 30, borderRadius: 15, border: 'none', padding: 2,
          cursor: props.disabled ? 'default' : 'pointer', flexShrink: 0,
          background: props.on ? '#34c759' : 'rgba(120,120,128,0.32)',
          display: 'flex', alignItems: 'center',
          justifyContent: props.on ? 'flex-end' : 'flex-start',
          transition: 'background 160ms ease, justify-content 160ms ease',
        },
      }, h('span', {
        style: {
          width: 26, height: 26, borderRadius: '50%', background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        },
      }));
    }

    /** One "when to notify" row: icon + copy + Try button + switch. */
    function ToggleRow(props) {
      const { name, t, state, edit, onTry, trying, children } = props;
      const field = state[name] || {};
      const on = Boolean(field.value);
      const disabled = !state.writable || state.saving;
      return h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
          borderRadius: 12, background: 'rgba(128,128,128,0.08)', marginBottom: 8,
        },
      },
        h(RowIcon, { kind: props.kind }),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontWeight: 600, fontSize: '0.95em' } }, t(name)),
          h('div', { style: { opacity: 0.7, fontSize: '0.82em', marginTop: 2, lineHeight: 1.4 } }, t(`${name}Hint`))),
        h(ActionButton, {
          disabled: disabled || !on,
          onClick: onTry,
          style: { marginRight: 4 },
        }, trying ? t('testSent') : t('tryIt')),
        h(BigSwitch, {
          on, disabled,
          onClick: () => edit(name, on ? 'false' : 'true'),
        }),
        children,
      );
    }

    /** A bounded number card (kept-count / min-gap). */
    function NumberCard(props) {
      const { name, label, unit, hint, value, min, max, disabled, onEdit } = props;
      const commit = (text) => {
        const n = Number(text);
        if (text !== '' && Number.isFinite(n)) {
          onEdit(String(Math.min(max, Math.max(min, Math.trunc(n)))));
        } else {
          onEdit(text);
        }
      };
      return h('div', {
        style: {
          flex: 1, minWidth: 160, padding: '12px 14px', borderRadius: 12,
          background: 'rgba(128,128,128,0.08)',
        },
      },
        h('label', { style: { fontWeight: 600, fontSize: '0.9em' } }, label),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 } },
          h('input', {
            type: 'number', min, max, value, disabled,
            onChange: (event) => commit(event.target.value),
            style: {
              width: 72, padding: '6px 8px', borderRadius: 8,
              border: '1px solid rgba(128,128,128,0.45)',
              background: 'transparent', color: 'inherit', fontSize: '1em',
            },
          }),
          h('span', { style: { opacity: 0.7, fontSize: '0.85em' } }, unit)),
        h('div', { style: { opacity: 0.7, fontSize: '0.8em', marginTop: 6 } }, hint));
    }

    // ---- user-designed settings page (verbatim DOM + scoped CSS) ----
    const PAGE_CSS = ".ksp-root{\n    --font: -apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif;\n    --page-bg: #eef1f6;\n    --panel-bg: #ffffff;\n    --text: #1d1d1f;\n    --sub: #6e6e73;\n    --faint: #8e8e93;\n    --line: rgba(0,0,0,.09);\n    --line-soft: rgba(0,0,0,.05);\n    --tile: rgba(120,120,128,.08);\n    --blue: #007aff;\n    --green: #34c759;\n    --orange: #ff9500;\n    --purple: #af52de;\n    --shadow: 0 10px 40px rgba(20,24,40,.12);}\n.ksp-root *{ box-sizing: border-box;}\n.ksp-root html, .ksp-root body{ height: 100%; margin: 0;}\n.ksp-root{\n    font-family: var(--font);\n    background: var(--page-bg);\n    color: var(--text);\n    -webkit-font-smoothing: antialiased;\n    overflow: hidden;}\n.ksp-root .editor-bar{\n    height: 52px;\n    display: flex;\n    align-items: center;\n    gap: 10px;\n    padding: 0 18px;\n    background: var(--panel-bg);\n    border-bottom: 1px solid var(--line);}\n.ksp-root .editor-bar .bar-title{ font-size: 14px; font-weight: 700; margin-right: 12px;}\n.ksp-root .editor-bar .bar-spacer{ flex: 1;}\n.ksp-root .bar-btn{\n    font-family: var(--font);\n    font-size: 12.5px;\n    padding: 7px 13px;\n    border-radius: 8px;\n    border: 1px solid var(--line);\n    background: #fff;\n    color: var(--text);\n    cursor: pointer;}\n.ksp-root .bar-btn:hover{ background: #f2f2f7;}\n.ksp-root .bar-btn.primary{ background: var(--blue); color: #fff; border-color: var(--blue);}\n.ksp-root .bar-btn.active{ background: rgba(0,122,255,.12); color: var(--blue); border-color: var(--blue);}\n.ksp-root .bar-hint{ font-size: 11px; color: var(--faint);}\n.ksp-root .workspace{ display: flex; height: calc(100% - 52px);}\n.ksp-root .canvas-area{\n    flex: 1;\n    overflow: auto;\n    padding: 28px;\n    display: flex;\n    justify-content: center;}\n.ksp-root .settings-page{\n    width: 100%;\n    max-width: 720px;\n    height: max-content;\n    background: var(--panel-bg);\n    border: 1px solid var(--line);\n    border-radius: 18px;\n    box-shadow: var(--shadow);\n    overflow: hidden;}\n.ksp-root .page-scroll{ padding: 28px 32px 40px;}\n.ksp-root .page-title{ font-size: 23px; font-weight: 700; letter-spacing: -.4px; margin: 0;}\n.ksp-root .page-lead{ font-size: 12px; color: var(--sub); line-height: 1.6; margin: 6px 0 0;}\n.ksp-root .section-title{\n    font-size: 11px;\n    font-weight: 700;\n    color: var(--faint);\n    letter-spacing: .5px;\n    text-transform: uppercase;\n    margin: 34px 0 12px 2px;}\n.ksp-root .section-subtitle{ font-size: 12px; color: var(--sub); margin: -6px 0 12px 2px;}\n.ksp-root .settings-group{\n    background: var(--panel-bg);\n    border: 1px solid var(--line);\n    border-radius: 14px;\n    overflow: hidden;}\n.ksp-root .master-card{\n    display: flex;\n    align-items: center;\n    gap: 16px;\n    padding: 18px;\n    background: var(--tile);\n    border-radius: 14px;}\n.ksp-root .master-icon{\n    width: 42px; height: 42px;\n    flex: 0 0 42px;\n    border-radius: 11px;\n    background: rgba(0,122,255,.12);\n    color: var(--blue);\n    display: flex; align-items: center; justify-content: center;}\n.ksp-root .master-icon svg{ width: 22px; height: 22px;}\n.ksp-root .master-text{ flex: 1; min-width: 0;}\n.ksp-root .master-title{ font-size: 15px; font-weight: 700;}\n.ksp-root .master-desc{ font-size: 12px; color: var(--sub); margin-top: 4px; line-height: 1.5;}\n.ksp-root .master-state{ font-size: 11px; font-weight: 700; color: var(--green);}\n.ksp-root .switch{\n    width: 44px; height: 26px;\n    flex: 0 0 44px;\n    border-radius: 20px;\n    border: 0; padding: 0;\n    background: rgba(120,120,128,.28);\n    position: relative;\n    cursor: pointer;\n    transition: background .2s;}\n.ksp-root .switch::after{\n    content: \"\";\n    position: absolute; top: 2px; left: 2px;\n    width: 22px; height: 22px;\n    border-radius: 50%;\n    background: #fff;\n    box-shadow: 0 2px 5px rgba(0,0,0,.22);\n    transition: transform .2s;}\n.ksp-root .switch.on{ background: var(--green);}\n.ksp-root .switch.on::after{ transform: translateX(18px);}\n.ksp-root .switch-large{ width: 50px; height: 30px; flex-basis: 50px;}\n.ksp-root .switch-large::after{ width: 26px; height: 26px;}\n.ksp-root .switch-large.on::after{ transform: translateX(20px);}\n.ksp-root .setting-row{\n    display: flex;\n    align-items: center;\n    gap: 13px;\n    padding: 15px 16px;\n    border-bottom: 1px solid var(--line-soft);}\n.ksp-root .setting-row:last-child{ border-bottom: 0;}\n.ksp-root .row-icon{\n    width: 34px; height: 34px;\n    flex: 0 0 34px;\n    border-radius: 9px;\n    display: flex; align-items: center; justify-content: center;}\n.ksp-root .row-icon svg{ width: 18px; height: 18px;}\n.ksp-root .icon-green{ background: rgba(52,199,89,.14); color: var(--green);}\n.ksp-root .icon-orange{ background: rgba(255,149,0,.14); color: var(--orange);}\n.ksp-root .icon-purple{ background: rgba(175,82,222,.13); color: var(--purple);}\n.ksp-root .icon-blue{ background: rgba(0,122,255,.12); color: var(--blue);}\n.ksp-root .row-text{ flex: 1; min-width: 0;}\n.ksp-root .row-title{ font-size: 13.5px; font-weight: 650; line-height: 1.35;}\n.ksp-root .row-desc{ font-size: 11.5px; color: var(--sub); line-height: 1.5; margin-top: 3px;}\n.ksp-root .try-button{\n    font-family: var(--font);\n    font-size: 11px; font-weight: 600;\n    color: var(--blue);\n    background: transparent;\n    border: 0; padding: 5px 7px;\n    border-radius: 6px;\n    cursor: pointer;\n    white-space: nowrap;}\n.ksp-root .try-button:hover{ background: rgba(0,122,255,.1);}\n.ksp-root .number-grid{\n    display: grid;\n    grid-template-columns: 1fr 1fr;\n    gap: 13px;}\n.ksp-root .number-card{\n    background: var(--panel-bg);\n    border: 1px solid var(--line);\n    border-radius: 14px;\n    padding: 16px;}\n.ksp-root .number-head{ display: flex; align-items: flex-start; gap: 12px;}\n.ksp-root .field-line{ display: flex; align-items: center; gap: 8px; margin-top: 15px; padding-left: 46px;}\n.ksp-root .number-input{\n    width: 96px;\n    font-family: var(--font);\n    font-size: 14px; font-weight: 700;\n    color: var(--blue);\n    background: #f7f8fa;\n    border: 1px solid var(--line);\n    border-radius: 8px;\n    padding: 8px 11px;}\n.ksp-root .field-unit{ font-size: 11.5px; color: var(--sub); font-weight: 600;}\n.ksp-root .field-hint{ font-size: 10px; color: var(--faint); margin-left: auto;}\n.ksp-root .tip-bar{\n    display: flex;\n    gap: 10px;\n    align-items: flex-start;\n    margin-top: 18px;\n    padding: 12px 14px;\n    background: rgba(0,122,255,.07);\n    border: 1px solid rgba(0,122,255,.16);\n    border-radius: 11px;\n    font-size: 11.5px;\n    color: var(--sub);\n    line-height: 1.55;}\n.ksp-root .tip-bar svg{ width: 16px; height: 16px; flex: 0 0 16px; color: var(--blue); margin-top: 1px;}\n.ksp-root .style-section{\n    background: var(--panel-bg);\n    border: 1px solid var(--line);\n    border-radius: 14px;\n    padding: 6px 16px 16px;}\n.ksp-root .control-row{\n    display: flex;\n    align-items: center;\n    gap: 12px;\n    padding: 11px 0;\n    border-bottom: 1px solid var(--line-soft);\n    flex-wrap: wrap;}\n.ksp-root .control-row:last-child{ border-bottom: 0;}\n.ksp-root .control-label{ width: 120px; flex: 0 0 120px; font-size: 12.5px; font-weight: 500;}\n.ksp-root .control-body{ flex: 1; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;}\n.ksp-root .segmented{\n    display: inline-flex;\n    border-radius: 9px;\n    padding: 2px;\n    background: var(--tile);\n    gap: 2px;\n    flex-wrap: wrap;}\n.ksp-root .segment{\n    font-family: var(--font);\n    border: 0;\n    border-radius: 7px;\n    padding: 5px 11px;\n    font-size: 12px;\n    background: transparent;\n    color: var(--text);\n    cursor: pointer;}\n.ksp-root .segment.selected{ background: var(--blue); color: #fff; font-weight: 600;}\n.ksp-root .select-block{ padding: 11px 0; border-bottom: 1px solid var(--line-soft);}\n.ksp-root .select-label{ display: block; font-size: 12.5px; font-weight: 600; margin-bottom: 6px;}\n.ksp-root .select-input{\n    width: 100%; max-width: 380px;\n    font-family: var(--font);\n    font-size: 13px;\n    padding: 8px 10px;\n    border: 1px solid var(--line);\n    border-radius: 8px;\n    background: #fff;\n    color: var(--text);}\n.ksp-root .control-note{ font-size: 11.5px; color: var(--faint);}\n.ksp-root .sound-title{ font-size: 13px; font-weight: 700; margin: 20px 0 0;}\n.ksp-root .sound-hint{ font-size: 11.5px; color: var(--sub); margin: 4px 0 0;}\n.ksp-root .sound-grid{\n    display: grid;\n    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));\n    gap: 9px;\n    margin-top: 12px;}\n.ksp-root .sound-card{\n    display: flex;\n    align-items: center;\n    gap: 10px;\n    padding: 10px 12px;\n    border-radius: 12px;\n    background: var(--tile);\n    border: 1px solid var(--line);\n    cursor: pointer;}\n.ksp-root .sound-card.selected{ background: rgba(0,122,255,.10); border-color: var(--blue);}\n.ksp-root .sound-play{\n    width: 34px; height: 34px;\n    flex: 0 0 34px;\n    border-radius: 50%;\n    border: 0;\n    background: var(--blue);\n    color: #fff;\n    font-size: 13px;\n    cursor: pointer;}\n.ksp-root .sound-text{ min-width: 0;}\n.ksp-root .sound-name{ font-size: 12.5px; font-weight: 600;}\n.ksp-root .sound-key{ font-size: 10.5px; color: var(--faint); margin-top: 1px;}\n.ksp-root .inspector{\n    width: 300px;\n    flex: 0 0 300px;\n    background: var(--panel-bg);\n    border-left: 1px solid var(--line);\n    display: flex;\n    flex-direction: column;\n    min-height: 0;}\n.ksp-root .inspector.collapsed{ display: none;}\n.ksp-root .inspector-head{ padding: 13px 14px 10px; border-bottom: 1px solid var(--line);}\n.ksp-root .inspector-head h2{ font-size: 12.5px; margin: 0 0 3px;}\n.ksp-root .inspector-head p{ font-size: 10.5px; color: var(--faint); margin: 0; line-height: 1.5;}\n.ksp-root .inspector-body{ overflow: auto; flex: 1; padding: 12px 14px 28px;}\n.ksp-root .selection-info{\n    font-size: 11px;\n    line-height: 1.6;\n    color: var(--sub);\n    background: rgba(0,122,255,.10);\n    border-radius: 9px;\n    padding: 9px 11px;\n    margin-bottom: 14px;\n    white-space: pre-line;}\n.ksp-root .prop-group{ margin-bottom: 16px;}\n.ksp-root .prop-group-title{\n    font-size: 10.5px; font-weight: 700;\n    color: var(--faint);\n    letter-spacing: .4px;\n    margin-bottom: 8px;\n    padding-bottom: 5px;\n    border-bottom: 1px solid var(--line-soft);}\n.ksp-root .prop-line{ display: flex; align-items: center; gap: 7px; margin-bottom: 7px; font-size: 12px;}\n.ksp-root .prop-line label{ width: 56px; flex: 0 0 56px; color: var(--sub);}\n.ksp-root .prop-line input[type=number], .ksp-root .prop-line select{\n    flex: 1; min-width: 0;\n    font-family: var(--font);\n    font-size: 12px;\n    padding: 5px 7px;\n    border: 1px solid var(--line);\n    border-radius: 6px;\n    background: #fff;\n    color: var(--text);}\n.ksp-root .prop-line input[type=color]{\n    width: 36px; height: 26px;\n    padding: 0;\n    border: 1px solid var(--line);\n    border-radius: 6px;\n    background: none;\n    cursor: pointer;}\n.ksp-root .prop-line .suffix{ font-size: 10px; color: var(--faint); width: 14px;}\n.ksp-root .prop-textarea{\n    width: 100%; min-height: 58px;\n    font-family: var(--font);\n    font-size: 12px;\n    padding: 8px;\n    border: 1px solid var(--line);\n    border-radius: 7px;\n    resize: vertical;}\n.ksp-root .prop-grid{ display: grid; grid-template-columns: 1fr 1fr; gap: 6px;}\n.ksp-root .reset-btn{\n    width: 100%;\n    font-family: var(--font);\n    font-size: 11.5px;\n    padding: 7px;\n    border: 1px solid var(--line);\n    border-radius: 7px;\n    background: #fff;\n    color: #d70015;\n    cursor: pointer;}\n.ksp-root .reset-btn:hover{ background: #fff5f5;}\n.ksp-root .editing [data-eid]:hover{ outline: 1px dashed rgba(0,122,255,.55); outline-offset: 1px; cursor: pointer;}\n.ksp-root [data-eid].selected{ outline: 2px solid var(--blue) !important; outline-offset: 2px !important;}\n.ksp-root [data-eid].editing-text{ background: rgba(0,122,255,.06);}\n.ksp-root .bar-btn:disabled{opacity:.4;cursor:not-allowed;}\n.ksp-root .bar-sep{width:1px;height:20px;background:var(--line);margin:0 3px;}\n.ksp-root .custom-block{margin:12px 2px;padding:14px 16px;background:var(--tile);border:1px dashed rgba(0,122,255,.5);border-radius:12px;font-size:13px;line-height:1.5;}\n.ksp-root .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(29,29,31,.92);color:#fff;font-size:12px;padding:9px 16px;border-radius:9px;z-index:999;opacity:0;transition:opacity .2s;pointer-events:none;}\n.ksp-root .toast.show{opacity:1;}\n\n  .ksp-root .setting-row.disabled{opacity:.45;pointer-events:none;}\n  .ksp-root.master-off .ksp-body{display:none !important;}\n  .ksp-root.native-mode [data-toast-only]{display:none !important;}\n  .ksp-root.native-mode .theme-seg{opacity:.45;pointer-events:none;}\n  .ksp-root .native-note{display:none;margin-left:8px;font-size:11.5px;color:var(--faint);}\n  .ksp-root.native-mode .native-note{display:inline;}\n  .ksp-root .sound-card{cursor:pointer;}\n  .ksp-root .sound-card.selected{background:rgba(0,122,255,.10);border-color:var(--blue);}\n  .ksp-root .segment.selected{background:var(--blue);color:#fff;font-weight:600;}\n  .ksp-root .switch{cursor:pointer;}\n  .ksp-root .ksp-savebar{display:flex;gap:10px;justify-content:flex-end;margin-top:22px;padding-top:16px;border-top:1px solid var(--line);}\n  .ksp-root .ksp-savebar button{font-family:var(--font);font-size:12.5px;padding:8px 18px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--text);cursor:pointer;}\n  .ksp-root .ksp-savebar button.primary{background:var(--blue);color:#fff;border-color:var(--blue);}\n  .ksp-root .ksp-savebar button:disabled{opacity:.45;cursor:not-allowed;}\n  .ksp-root .ksp-err{font-size:12px;color:#d70015;margin:0 0 8px;}\n";
    const PAGE_HTML = "<div class=\"settings-page\" id=\"settingsPage\">\n      <div class=\"page-scroll\">\n\n        <h1 class=\"page-title\">通知设置</h1>\n        <p class=\"page-lead\">所有设置修改后立即生效，不需要重启 DeepSeek Harness。</p>\n\n        <!-- 总开关 -->\n        <section class=\"master-card\">\n          <div class=\"master-icon\">\n            <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\"><path d=\"M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9\"></path><path d=\"M10 21h4\"></path></svg>\n          </div>\n          <div class=\"master-text\">\n            <div class=\"master-title\">桌面通知总开关</div>\n            <div class=\"master-desc\">关掉后不再弹出任何通知。</div>\n          </div>\n          <span class=\"master-state\" data-state-text=\"master\">已开启</span>\n          <button class=\"switch switch-large on\" type=\"button\" aria-label=\"桌面通知总开关\" data-bind=\"enabled\"></button>\n        </section><div class=\"ksp-body\">\n\n        <!-- 消息提醒时机 -->\n        <h2 class=\"section-title\">消息提醒时机</h2>\n        \n\n        <section class=\"settings-group\">\n          <div class=\"setting-row\">\n            <div class=\"row-icon icon-green\">\n              <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\"><path d=\"M21 11.5V12a9 9 0 1 1-2.6-6.4\"></path><path d=\"M21 4v5h-5\"></path><path d=\"m9 12 2 2 4-4\"></path></svg>\n            </div>\n            <div class=\"row-text\">\n              <div class=\"row-title\">对话结束时</div>\n              <div class=\"row-desc\">回答完成、你点了停止、运行出错、或回复被字数上限截断。</div>\n            </div>\n            \n            <button class=\"try-button\" type=\"button\" data-try=\"done\">试一下</button> <button class=\"switch on\" type=\"button\" aria-label=\"对话结束时提醒\" data-bind=\"notifyOnComplete\"></button>\n          </div>\n\n          <div class=\"setting-row\">\n            <div class=\"row-icon icon-orange\">\n              <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\"><path d=\"M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3Z\"></path><path d=\"m9 12 2 2 4-4\"></path></svg>\n            </div>\n            <div class=\"row-text\">\n              <div class=\"row-title\">对话批准时</div>\n              <div class=\"row-desc\">Agent 要运行命令或改文件时提醒你；你一批准，提醒会自动收起。</div>\n            </div>\n            \n            <button class=\"try-button\" type=\"button\" data-try=\"approve\">试一下</button> <button class=\"switch on\" type=\"button\" aria-label=\"等待审批时提醒\" data-bind=\"notifyOnApproval\"></button>\n          </div>\n\n          <div class=\"setting-row\">\n            <div class=\"row-icon icon-purple\">\n              <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\"><path d=\"M21 12a8 8 0 0 1-8 8H7l-4 2 1.2-4A8 8 0 1 1 21 12Z\"></path><path d=\"M9.5 10a2.6 2.6 0 0 1 5 .8c0 1.8-2.5 2-2.5 3.7\"></path><path d=\"M12 17.5h.01\"></path></svg>\n            </div>\n            <div class=\"row-text\">\n              <div class=\"row-title\">对话确认时</div>\n              <div class=\"row-desc\">Agent 让你做选择时提醒，比如选哪个方案、用哪个模型。</div>\n            </div>\n            \n            <button class=\"try-button\" type=\"button\" data-try=\"ask\">试一下</button> <button class=\"switch on\" type=\"button\" aria-label=\"等待回答时提醒\" data-bind=\"notifyOnQuestion\"></button>\n          </div>\n        </section>\n\n        <!-- 提醒多少、多频繁 -->\n        <h2 class=\"section-title\">提醒多少、多频繁</h2>\n        <p class=\"section-subtitle\">既不错过，也不打扰。</p>\n\n        <div class=\"number-grid\">\n          <div class=\"number-card\">\n            <div class=\"number-head\">\n              <div class=\"row-icon icon-blue\">\n                <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\"><path d=\"m12 3 9 5-9 5-9-5 9-5Z\"></path><path d=\"m3 13 9 5 9-5M3 17l9 5 9-5\"></path></svg>\n              </div>\n              <div class=\"row-text\">\n                <div class=\"row-title\">单一对话留存条数</div>\n                <div class=\"row-desc\">同一对话只保留最新的几条，旧的自动收起。</div>\n              </div>\n            </div>\n            <div class=\"field-line\">\n              <input class=\"number-input\" type=\"number\" min=\"1\" max=\"50\" value=\"3\" aria-label=\"单一对话留存条数\" data-bind=\"maxPerSession\">\n              <span class=\"field-unit\">条</span>\n              <span class=\"field-hint\">1~5可选</span>\n            </div>\n          </div>\n\n          <div class=\"number-card\">\n            <div class=\"number-head\">\n              <div class=\"row-icon icon-orange\">\n                <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\"><circle cx=\"12\" cy=\"12\" r=\"9\"></circle><path d=\"M12 7v5l3.5 2\"></path></svg>\n              </div>\n              <div class=\"row-text\">\n                <div class=\"row-title\">消息提醒间隔</div>\n                <div class=\"row-desc\" style=\"white-space: pre-wrap; cursor: text;\">两次提醒之间至少隔多久，防止短时间刷屏​</div>\n              </div>\n            </div>\n            <div class=\"field-line\">\n              <input class=\"number-input\" type=\"number\" min=\"0\" max=\"3600\" value=\"0\" aria-label=\"消息提醒间隔\" data-bind=\"minIntervalSeconds\">\n              <span class=\"field-unit\">秒</span>\n              <span class=\"field-hint\">最小1秒</span>\n            </div>\n          </div>\n        </div>\n\n        \n\n        <!-- 通知样式 -->\n        <h2 class=\"section-title\">通知样式</h2>\n\n        <div class=\"style-section\">\n          <div class=\"control-row\">\n            <span class=\"control-label\">配色</span>\n            <div class=\"control-body\">\n              <div class=\"segmented\">\n                <button class=\"segment theme-seg\" type=\"button\" data-bind=\"theme\" data-value=\"light\">浅色</button>\n                <button class=\"segment theme-seg\" type=\"button\" data-bind=\"theme\" data-value=\"dark\">深色</button>\n                <button class=\"segment theme-seg\" type=\"button\" data-bind=\"theme\" data-value=\"auto\">跟随系统深浅色</button>\n              </div>\n            <span class=\"native-note\" data-i18n=\"systemStyleNote\">选择系统通知时卡片样式由系统决定。</span></div>\n          </div>\n\n          <div class=\"control-row\">\n            <span class=\"control-label\">通知样式</span>\n            <div class=\"control-body\">\n              <select class=\"select-input\" aria-label=\"通知样式\" data-bind=\"renderer\">\n                <option value=\"toast\">仿 macOS（自定义设置）</option>\n                <option value=\"native\">系统通知（系统样式与提示音）</option>\n              </select>\n            </div>\n          </div>\n\n          <div class=\"control-row\" data-toast-only>\n            <span class=\"control-label\">弹出位置</span>\n            <div class=\"control-body\">\n              <div class=\"segmented\">\n                <button class=\"segment\" type=\"button\" data-bind=\"position\" data-value=\"top-center\">顶部居中</button>\n                <button class=\"segment\" type=\"button\" data-bind=\"position\" data-value=\"top-right\">右上角横幅</button>\n                <button class=\"segment\" type=\"button\" data-bind=\"position\" data-value=\"bottom-right\">右下角</button>\n              </div>\n            </div>\n          </div>\n\n          <div class=\"control-row\" data-toast-only>\n            <span class=\"control-label\">入场动效</span>\n            <div class=\"control-body\">\n              <div class=\"segmented\">\n                <button class=\"segment selected\" type=\"button\" style=\"\" data-bind=\"animation\" data-value=\"elastic\">弹性回弹​</button>\n                <button class=\"segment\" type=\"button\" style=\"\" data-bind=\"animation\" data-value=\"crisp\">干脆滑入​</button>\n                <button class=\"segment\" type=\"button\" style=\"\" data-bind=\"animation\" data-value=\"soft\">柔和淡入\n</button>\n              </div>\n            </div>\n          </div>\n\n          <div class=\"control-row\" data-toast-only>\n            <span class=\"control-label\">停留时间</span>\n            <div class=\"control-body\">\n              <div class=\"segmented\">\n                <button class=\"segment\" type=\"button\" data-bind=\"timeoutMs\" data-value=\"1000\">1 秒</button>\n                <button class=\"segment\" type=\"button\" data-bind=\"timeoutMs\" data-value=\"3000\">3 秒</button>\n                <button class=\"segment\" type=\"button\" data-bind=\"timeoutMs\" data-value=\"5000\">5 秒</button>\n                <button class=\"segment\" type=\"button\" data-bind=\"timeoutMs\" data-value=\"10000\">10 秒</button>\n                <button class=\"segment\" type=\"button\" data-bind=\"timeoutMs\" data-value=\"30000\">30 秒</button>\n                <button class=\"segment\" type=\"button\" data-bind=\"timeoutMs\" data-value=\"60000\">60 秒</button>\n              </div>\n            </div>\n          </div>\n\n          <h3 class=\"sound-title\" data-toast-only>提示音试听与选择</h3>\n          \n\n          <div class=\"sound-grid\" data-toast-only>\n            <div class=\"sound-card\" data-bind=\"soundName\" data-value=\"glass\"><button class=\"sound-play\" type=\"button\" data-play=\"glass\">▶</button><div class=\"sound-text\"><div class=\"sound-name\">玻璃/水晶</div></div></div>\n            <div class=\"sound-card\" data-bind=\"soundName\" data-value=\"morse\"><button class=\"sound-play\" type=\"button\" data-play=\"morse\">▶</button><div class=\"sound-text\"><div class=\"sound-name\">摩斯/乒乓</div></div></div>\n            <div class=\"sound-card\" data-bind=\"soundName\" data-value=\"ping\"><button class=\"sound-play\" type=\"button\" data-play=\"ping\">▶</button><div class=\"sound-text\"><div class=\"sound-name\">声纳</div></div></div>\n            <div class=\"sound-card\" data-bind=\"soundName\" data-value=\"pop\"><button class=\"sound-play\" type=\"button\" data-play=\"pop\">▶</button><div class=\"sound-text\"><div class=\"sound-name\">气泡</div></div></div>\n            <div class=\"sound-card\" data-bind=\"soundName\" data-value=\"sosumi\"><button class=\"sound-play\" type=\"button\" data-play=\"sosumi\">▶</button><div class=\"sound-text\"><div class=\"sound-name\">Sosumi</div></div></div>\n            <div class=\"sound-card\" data-bind=\"soundName\" data-value=\"tink\"><button class=\"sound-play\" type=\"button\" data-play=\"tink\">▶</button><div class=\"sound-text\"><div class=\"sound-name\">叮咚</div></div></div>\n            <div class=\"sound-card\" data-bind=\"soundName\" data-value=\"tritone\"><button class=\"sound-play\" type=\"button\" data-play=\"tritone\">▶</button><div class=\"sound-text\"><div class=\"sound-name\">三全音</div></div></div>\n            <div class=\"sound-card\" data-bind=\"soundName\" data-value=\"rebound\"><button class=\"sound-play\" type=\"button\" data-play=\"rebound\">▶</button><div class=\"sound-text\"><div class=\"sound-name\">反弹</div></div></div>\n            <div class=\"sound-card\" data-bind=\"soundName\" data-value=\"welcome\"><button class=\"sound-play\" type=\"button\" data-play=\"welcome\">▶</button><div class=\"sound-text\"><div class=\"sound-name\">欢迎</div></div></div>\n            <div class=\"sound-card\" data-bind=\"soundName\" data-value=\"cheers\"><button class=\"sound-play\" type=\"button\" data-play=\"cheers\">▶</button><div class=\"sound-text\"><div class=\"sound-name\">欢呼</div></div></div>\n            <div class=\"sound-card\" data-bind=\"soundName\" data-value=\"pop26\"><button class=\"sound-play\" type=\"button\" data-play=\"pop26\">▶</button><div class=\"sound-text\"><div class=\"sound-name\">Pop</div></div></div>\n            <div class=\"sound-card\" data-bind=\"soundName\" data-value=\"bird\"><button class=\"sound-play\" type=\"button\" data-play=\"bird\">▶</button><div class=\"sound-text\"><div class=\"sound-name\">小鸟</div></div></div>\n            <div class=\"sound-card\" data-bind=\"soundName\" data-value=\"wxDefault\"><button class=\"sound-play\" type=\"button\" data-play=\"wxDefault\">▶</button><div class=\"sound-text\"><div class=\"sound-name\">默认</div></div></div>\n            \n            <div class=\"sound-card\" data-bind=\"soundName\" data-value=\"wxAiry\"><button class=\"sound-play\" type=\"button\" data-play=\"wxAiry\">▶</button><div class=\"sound-text\"><div class=\"sound-name\">空灵</div></div></div>\n            <div class=\"sound-card\" data-bind=\"soundName\" data-value=\"wxPlayful\"><button class=\"sound-play\" type=\"button\" data-play=\"wxPlayful\">▶</button><div class=\"sound-text\"><div class=\"sound-name\">俏皮</div></div></div>\n            <div class=\"sound-card\" data-bind=\"soundName\" data-value=\"wxCrisp\"><button class=\"sound-play\" type=\"button\" data-play=\"wxCrisp\">▶</button><div class=\"sound-text\"><div class=\"sound-name\">清脆</div></div></div>\n            <div class=\"sound-card\" data-bind=\"soundName\" data-value=\"wxElegant\"><button class=\"sound-play\" type=\"button\" data-play=\"wxElegant\">▶</button><div class=\"sound-text\"><div class=\"sound-name\">优雅</div></div></div>\n          </div>\n        </div>\n\n      </div></div>";

    const PAGE_CSS_TEXT = PAGE_CSS
      + '\n.ksp-root.ksp-disabled{opacity:.6;pointer-events:none;}'
      + '\n.ksp-root .try-button.trying{opacity:.5;}';

    /** The full settings page for this bundle — renders the user-designed page verbatim. */
    function KylinSettings(props) {
      const state = props.useKylinCard((snapshot) => snapshot);
      const t = props.t;

      if (props.view === 'summary') return null;

      const disabled = !state.writable || state.saving;
      const boolVal = (name) => Boolean(state[name] && state[name].value);
      const textVal = (name, fallback) => {
        const raw = state[name] && state[name].text;
        const typed = String(raw == null ? '' : raw).trim();
        return typed === '' ? String(fallback) : typed;
      };
      const pick = (name, options) => {
        const values = options.map((o) => String(o.value));
        const typed = textVal(name, values[0]);
        return values.includes(typed) ? typed : values[0];
      };

      const masterOn = boolVal('enabled');
      const rendererValue = pick('renderer', RENDERER_OPTIONS);
      const isToast = rendererValue === 'toast';
      const theme = pick('theme', THEME_OPTIONS);
      const position = pick('position', POSITION_OPTIONS);
      const animation = pick('animation', ANIMATION_OPTIONS);
      const soundName = pick('soundName', SOUND_OPTIONS);
      const dwell = pick('timeoutMs', DWELL_OPTIONS);
      const maxPerSession = textVal('maxPerSession', 3);
      const minIntervalSeconds = textVal('minIntervalSeconds', 0);

      const rootRef = React.useRef(null);
      const latest = React.useRef(null);

      const sendTry = (kind) => {
        const bodies = { done: 'testDoneBody', approve: 'testApproveBody', ask: 'testAskBody' };
        sendTestPopup(t('testTitle'), t(bodies[kind] || 'testBody'));
      };

      latest.current = { props, t, masterOn, boolVal, sendTry, disabled };

      const sig = [masterOn, rendererValue, theme, position, animation, soundName,
        dwell, maxPerSession, minIntervalSeconds, boolVal('notifyOnComplete'),
        boolVal('notifyOnApproval'), boolVal('notifyOnQuestion'), disabled,
        t('masterOn'), t('masterOff'), t('systemStyleNote')].join('|');

      // Sync the store state onto the static DOM (classes, values, labels).
      React.useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        root.classList.toggle('master-off', !masterOn);
        root.classList.toggle('native-mode', !isToast);
        root.classList.toggle('ksp-disabled', !!disabled);

        root.querySelectorAll('button[data-bind]').forEach((el) => {
          const bind = el.getAttribute('data-bind');
          let on = false;
          if (bind === 'enabled') on = masterOn;
          else if (bind === 'notifyOnComplete') on = boolVal('notifyOnComplete');
          else if (bind === 'notifyOnApproval') on = boolVal('notifyOnApproval');
          else if (bind === 'notifyOnQuestion') on = boolVal('notifyOnQuestion');
          el.classList.toggle('on', on);
          el.setAttribute('aria-checked', on ? 'true' : 'false');
        });

        const setInput = (bind, value) => {
          const el = root.querySelector('input[data-bind="' + bind + '"]');
          if (el && document.activeElement !== el) el.value = value;
        };
        setInput('maxPerSession', maxPerSession);
        setInput('minIntervalSeconds', minIntervalSeconds);

        const sel = root.querySelector('select[data-bind="renderer"]');
        if (sel) sel.value = rendererValue;

        const segmentValues = { theme, position, animation, timeoutMs: dwell };
        ['theme', 'position', 'animation', 'timeoutMs'].forEach((bind) => {
          root.querySelectorAll('button[data-bind="' + bind + '"]').forEach((el) => {
            el.classList.toggle('selected', el.getAttribute('data-value') === segmentValues[bind]);
          });
        });

        root.querySelectorAll('[data-bind="soundName"]').forEach((el) => {
          el.classList.toggle('selected', el.getAttribute('data-value') === soundName);
        });

        const ms = root.querySelector('[data-state-text="master"]');
        if (ms) ms.textContent = masterOn ? t('masterOn') : t('masterOff');
        root.querySelectorAll('[data-i18n]').forEach((el) => {
          const key = el.getAttribute('data-i18n');
          const val = t(key);
          if (val && val !== key) el.textContent = val;
        });
      }, [sig]);

      // Event delegation — installed once, always reads the freshest store via latest.current.
      React.useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        const onClick = (event) => {
          const cur = latest.current;
          if (cur.disabled) return;
          const target = event.target;

          const play = target.closest('[data-play]');
          if (play) {
            event.preventDefault();
            const name = play.getAttribute('data-play');
            if (name) playSound(name, 0.6);
            return;
          }

          const tryBtn = target.closest('[data-try]');
          if (tryBtn) {
            event.preventDefault();
            cur.sendTry(tryBtn.getAttribute('data-try'));
            tryBtn.classList.add('trying');
            window.setTimeout(() => tryBtn.classList.remove('trying'), 1200);
            return;
          }

          const bound = target.closest('button[data-bind]');
          if (bound) {
            const bind = bound.getAttribute('data-bind');
            if (bind === 'enabled') {
              cur.props.edit('enabled', cur.masterOn ? 'false' : 'true');
            } else if (bind === 'notifyOnComplete' || bind === 'notifyOnApproval' || bind === 'notifyOnQuestion') {
              cur.props.edit(bind, cur.boolVal(bind) ? 'false' : 'true');
            } else if (['theme', 'position', 'animation', 'timeoutMs'].includes(bind)) {
              const value = bound.getAttribute('data-value');
              if (value) cur.props.edit(bind, value);
            }
            return;
          }

          const sc = target.closest('[data-bind="soundName"]');
          if (sc) {
            const value = sc.getAttribute('data-value');
            if (value) {
              cur.props.edit('soundName', value);
              playSound(value, 0.6);
            }
          }
        };

        const onInput = (event) => {
          const cur = latest.current;
          if (cur.disabled) return;
          const el = event.target;
          if (el.tagName === 'INPUT' && el.getAttribute('data-bind')) {
            const bind = el.getAttribute('data-bind');
            if (bind === 'maxPerSession' || bind === 'minIntervalSeconds') {
              cur.props.edit(bind, el.value);
            }
          } else if (el.tagName === 'SELECT' && el.getAttribute('data-bind') === 'renderer') {
            cur.props.edit('renderer', el.value);
          }
        };

        root.addEventListener('click', onClick);
        root.addEventListener('input', onInput);
        root.addEventListener('change', onInput);
        return () => {
          root.removeEventListener('click', onClick);
          root.removeEventListener('input', onInput);
          root.removeEventListener('change', onInput);
        };
      }, []);

      const rootClass = 'ksp-root'
        + (masterOn ? '' : ' master-off')
        + (isToast ? '' : ' native-mode')
        + (disabled ? ' ksp-disabled' : '');

      return h(
        primitives.SettingsForm,
        {
          labels: {
            unavailable: t('unavailable'),
            readOnly: t('readOnly'),
            saveFailed: t('saveFailed'),
            save: t('save'),
            saving: t('saving'),
          },
          state,
          onSave: props.save,
          onDiscard: props.discard,
        },
        h('style', { key: 'ksp-style' }, PAGE_CSS_TEXT),
        h('div', {
          ref: rootRef,
          className: rootClass,
          dangerouslySetInnerHTML: { __html: PAGE_HTML },
        })
      );
    }

    function readSessionFromHash() {
      try {
        const hash = window.location.hash || '';
        const body = hash.startsWith('#') ? hash.slice(1) : hash;
        const params = new URLSearchParams(body);
        const id = params.get('session');
        return id ? decodeURIComponent(id) : '';
      } catch {
        return '';
      }
    }

    function clearSessionHash() {
      try {
        const clean = window.location.pathname + window.location.search;
        window.history.replaceState(null, '', clean);
      } catch {
        /* non-fatal */
      }
    }

    /**
     * Keep the deep-link behaviour: a notification click must land on its
     * conversation even when the catalog is still loading.
     */
    function installDeepLinks(ctx) {
      let handledThisLoad = false;
      let pending = '';

      const focus = (sessionId) => {
        if (!sessionId) return;
        try {
          ctx.uiWorkspace.openSession(sessionId);
          pending = '';
          clearSessionHash();
        } catch {
          // The catalog or connection is not ready yet; tryFocus retries on
          // the next session-list update.
          pending = sessionId;
        }
      };

      const tryFocus = () => {
        if (!pending) return;
        const list = ctx.sessions && ctx.sessions.list;
        const snap = list && typeof list.getSnapshot === 'function' ? list.getSnapshot() : undefined;
        if (!snap || snap.phase !== 'ready') return;
        const id = pending;
        pending = '';
        focus(id);
      };

      const tryFocusWith = (id) => {
        pending = id;
        tryFocus();
      };

      ctx.effect(() => {
        const onHashChange = () => {
          const id = readSessionFromHash();
          if (id) tryFocusWith(id);
        };
        window.addEventListener('hashchange', onHashChange);

        const stopList = ctx.sessions && ctx.sessions.list && typeof ctx.sessions.list.subscribe === 'function'
          ? ctx.sessions.list.subscribe(tryFocus)
          : undefined;

        const timers = [];
        const initialId = readSessionFromHash();
        if (initialId && !handledThisLoad) {
          handledThisLoad = true;
          tryFocusWith(initialId);
          // Give up after a bounded time so a stale hash cannot spin forever.
          timers.push(window.setTimeout(() => {
            if (pending) pending = '';
          }, 15000));
        }

        return () => {
          window.removeEventListener('hashchange', onHashChange);
          for (const timer of timers) window.clearTimeout(timer);
          if (stopList) stopList();
        };
      }, 'kylin-notifier: deep-link focus');
    }

    function apply(ctx) {
      installDeepLinks(ctx);

      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'kylin-notifier: dictionaries');
      const t = ctx.locale.bind(NS);

      const cards = new Map();
      const cardFor = (name) => {
        let built = cards.get(name);
        if (built === undefined) {
          built = createForm(ctx.configForms.get(SETTINGS_NS));
          cards.set(name, built);
        }
        return built;
      };
      ctx.effect(() => () => {
        for (const built of cards.values()) built.model.dispose();
        cards.clear();
      }, 'kylin-notifier: settings form subscriptions');

      const face = () => {
        const built = cardFor(SETTINGS_NS);
        return {
          ...built.model.actions(),
          t,
          chinese: isZhLocale(ctx.locale),
          hooks: {
            kylinCard: built.store,
          },
        };
      };

      // Sidebar entry: Settings -> 银河麒麟桌面通知. Own page, own nav row.
      ctx.effect(
        () => ctx.configForms.whileServed([SETTINGS_NS], () => ctx.slots.inject('settings.section', () => ctx.slots.register(
          {
            name: 'settings.section',
            id: SECTION_ID,
            order: 30,
            label: () => t('title'),
            locale: NS,
            inject: face,
          },
          KylinSettings,
        ))),
        'kylin-notifier: settings section',
      );

      // Matching navigation icon, addressed by the section id above. Without
      // it the shell keeps its default glyph.
      ctx.slots.inject('settings.section.icon', () => ctx.slots.register(
        { name: 'settings.section.icon', id: SECTION_ID, order: 30 },
        BellIcon,
      ));

      // Only register the page while the Host actually serves our namespace, so
      // a plugin whose settings failed to load shows no half-empty form.
      ctx.effect(
        () => ctx.configForms.whileServed([SETTINGS_NS], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
          {
            name: 'plugins.bundle.config',
            key: BUNDLE_NAME,
            label: () => t('title'),
            locale: NS,
            inject: face,
          },
          KylinSettings,
        ))),
        'kylin-notifier: settings page',
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});