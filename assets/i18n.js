// ============================================================
// FaceTalk i18n · 中文 / English / 日本語
// 无构建步骤的纯前端多语言：字典 + 引擎 + 语言切换器
//   - 语言偏好存 localStorage('ft_lang')，缺省按浏览器语言探测（zh/en/ja）
//   - 静态文本用 data-i18n(data-i18n-html/ph/title/aria) 标注，JS 动态文本用 FTI18N.t()
//   - 切换语言：FTI18N.setLang(l) 会重扫静态节点 + 通知已注册的 onChange 回调重渲染动态区
// 加载顺序：必须先于 app.js / pair.html 内联脚本 / wall.js / settings.js / interview.js
// ============================================================
(function () {
  'use strict';
  var LANGS = ['zh', 'en', 'ja'];
  var LANG_MAP = { zh: 'zh-CN', en: 'en', ja: 'ja' };
  var STORAGE_KEY = 'ft_lang';

  var DICT = {
    // ───────────── 全局 / 通用 ─────────────
    langName: { zh: '中文', en: '中文', ja: '中文' },
    metaTitle: { zh: '面试搭子匹配 · 60秒试音找练友 | FaceTalk', en: 'Interview Practice Match · 60s Voice Tryout | FaceTalk', ja: '面接練習マッチング · 60秒ボイス試し | FaceTalk' },
    metaDesc: { zh: 'FaceTalk 面试搭子匹配平台：60秒试音筛选，在面试圈找到真正适合一起练的人。免费、匿名、免登录。', en: 'FaceTalk helps you find the right interview practice partner: 60-second voice tryout, mutual pick, then go deep. Free, anonymous, no sign-up.', ja: 'FaceTalkは面接練習相手探しサービス：60秒のボイス試し、相互選択、その後じっくり対練。無料・匿名・ログイン不要。' },
    menuLabel: { zh: '菜单', en: 'Menu', ja: 'メニュー' },
    warmupMenu: { zh: '🌡 声纹暖场', en: '🌡 Voice Warm-up', ja: '🌡 ボイスウォームアップ' },
    settingsMenu: { zh: '⚙ 设置与关于', en: '⚙ Settings & About', ja: '⚙ 設定と情報' },
    structPractice: { zh: '🎤 结构化面试练习', en: '🎤 Structured Interview Practice', ja: '🎤 構造化面接練習' },
    close: { zh: '关闭', en: 'Close', ja: '閉じる' },
    back: { zh: '← 返回', en: '← Back', ja: '← 戻る' },
    copied: { zh: '已复制', en: 'Copied', ja: 'コピーしました' },
    copyFailed: { zh: '复制失败，请长按手动复制', en: 'Copy failed, please long-press to copy', ja: 'コピー失敗。長押しでコピーしてください' },

    // ───────────── index.html 顶部 ─────────────
    wxTip: { zh: '如按钮无法跳转到腾讯会议，请点右上角 ⋯ 选择「在浏览器打开」，或复制会议号手动入会。', en: 'If the button can\'t open Tencent Meeting, tap ⋯ in the top-right and choose "Open in browser", or copy the meeting ID and join manually.', ja: 'ボタンでテンセント会議が開けない場合は、右上の ⋯ から「ブラウザで開く」を選ぶか、会議番号をコピーして手動参加してください。' },

    // ───────────── Hero ─────────────
    heroEyebrow: { zh: '面试筛选器', en: 'Interview Screener', ja: '面接フィルター' },
    heroTitle: { zh: '60 秒，决定要不要聊下去', en: '60 seconds to decide whether to keep talking', ja: '60秒で、話し続けるか決める' },
    heroKicker: { zh: '投正式对练前，先听一段短音，判断对方值不值得组队', en: 'Before a full practice session, listen to a short clip and judge if they\'re worth pairing with', ja: '本番対練の前に、短い音声を聴いて組む価値があるか判断しよう' },
    entryStart: { zh: '开始筛选', en: 'Start Screening', ja: 'フィルター開始' },
    entryDesc: { zh: '双向都愿意，再接着深入练', en: 'Only when both agree, go deeper', ja: '双方が合意してから、さらに深く練習' },
    entryGo: { zh: '去试音 →', en: 'Try out →', ja: '試し録音へ →' },
    trustBoth: { zh: '🔒 双方提交才能互听', en: '🔒 Both submit to hear each other', ja: '🔒 双方提出後にのみ互聴' },
    trustBurn: { zh: '🕓 录音阅后即焚', en: '🕓 Clips self-destruct after review', ja: '🕓 音声は確認後に自動消去' },
    trustNoContact: { zh: '🚫 严禁留微信 / 手机号', en: '🚫 No WeChat / phone numbers', ja: '🚫 微信・電話番号の共有禁止' },

    // ───────────── 声纹暖场 ─────────────
    warmupTitle: { zh: '声纹暖场', en: 'Voice Warm-up', ja: 'ボイスウォームアップ' },
    warmupSub: { zh: '说点什么，文字会跟着你的声音抖一抖', en: 'Say something — the text will jiggle with your voice', ja: '何か話すと、文字が声に合わせて揺れます' },
    warmupStart: { zh: '开始暖场', en: 'Start Warm-up', ja: 'ウォームアップ開始' },
    warmupStop: { zh: '🛑 停止', en: '🛑 Stop', ja: '🛑 停止' },
    warmupNoMic: { zh: '当前浏览器不支持麦克风，用手机打开体验更佳', en: 'This browser doesn\'t support the microphone — try on a phone for a better experience', ja: 'このブラウザはマイク非対応。スマホで開くとより良い体験ができます' },
    warmupSpeaking: { zh: '说吧，文字在跟着你抖', en: 'Talk — the text is jiggling with you', ja: '話してみて。文字が揺れています' },
    warmupDenied: { zh: '麦克风权限被拒，点「开始暖场」再授权一次', en: 'Microphone access denied — tap "Start Warm-up" to grant again', ja: 'マイク権限が拒否されました。「ウォームアップ開始」でもう一度許可してください' },

    // ───────────── 社群分享卡 ─────────────
    shareTitle: { zh: '📣 发到社群里匹配，互评组队，效果更佳', en: '📣 Share in your community for better matches', ja: '📣 コミュニティに共有して、より良いマッチングを' },
    shareSub: { zh: '把下面这段话发到你的辅警 / 消防 / 公考面试群里，同样目标的人看到就会来试音。', en: 'Post this to your interview-prep group — people with the same goal will come try out.', ja: 'この文を面接対策のグループに貼ってください。同じ目標の人たちが試しに来てくれます。' },
    sharePreview: { zh: '有人一起练面试吗？用 FaceTalk 60 秒试音，双方都愿意再组队 👉 facetalk.955827.xyz', en: 'Anyone up for interview practice? Use FaceTalk 60s voice tryout — we only pair when both agree 👉 facetalk.955827.xyz', ja: '一緒に面接練習しませんか？FaceTalkで60秒のボイス試し。双方合意したら組もう 👉 facetalk.955827.xyz' },
    shareCopyBtn: { zh: '📋 复制这段话，去群里发', en: '📋 Copy this text and share it', ja: '📋 この文をコピーして共有' },
    shareCopied: { zh: '✅ 已复制，去群里粘贴吧', en: '✅ Copied — paste it in your group', ja: '✅ コピーしました。グループに貼ってください' },
    shareCopiedShort: { zh: '✓ 已复制', en: '✓ Copied', ja: '✓ コピー済み' },

    // ───────────── 我的信誉条 ─────────────
    myRep: { zh: '我的信誉', en: 'My Reputation', ja: '自分の評価' },
    anonLocal: { zh: '匿名身份 · 仅本地保存', en: 'Anonymous identity · stored locally only', ja: '匿名ID · ローカルのみ保存' },

    // ───────────── 发布意图 ─────────────
    pubTitle: { zh: '📋 发布你的意图', en: '📋 Post Your Intent', ja: '📋 あなたの意図を投稿' },
    pubHint: { zh: '同岗伙伴来和你筛选，双方都愿意再接着练；录音仅用于本次互评，结束后自动删除。', en: 'Same-role partners come to screen with you; you continue only when both agree. Clips are used only for this review and auto-deleted after.', ja: '同じ職種の相手があなたを選びに来ます。双方合意で続行。音声は今回の評価のみに使い、終了後自動削除されます。' },
    pubRole: { zh: '岗位', en: 'Role', ja: '職種' },
    pubCity: { zh: '城市', en: 'City', ja: '都市' },
    pubMode: { zh: '模式', en: 'Mode', ja: 'モード' },
    pubNote: { zh: '一句话（选填）', en: 'One-liner (optional)', ja: '一言（任意）' },
    pubSubmit: { zh: '发布意图 →', en: 'Post Intent →', ja: '意図を投稿 →' },
    pubRoleGwy: { zh: '公务员 / 事业编', en: 'Civil Servant / Public Institution', ja: '公務員 / 事業編' },
    pubRoleFujing: { zh: '辅警 / 警务辅助', en: 'Auxiliary Police', ja: '補助警察' },
    pubRoleXiaofang: { zh: '消防 / 政府专职消防员', en: 'Firefighter / Government Fire Brigade', ja: '消防 / 政府専任消防士' },
    pubRoleShuji: { zh: '书记员 / 公检法聘用人员', en: 'Court Clerk / Judicial Staff', ja: '書記官 / 司法機関職員' },
    pubRoleShequ: { zh: '社区工作者 / 网格员', en: 'Community Worker / Grid Officer', ja: 'コミュニティワーカー' },
    pubRoleSanzhi: { zh: '三支一扶 / 西部计划', en: 'Grassroots Service / Western Plan', ja: '三支一扶 / 西部計画' },
    pubRoleOther: { zh: '其他', en: 'Other', ja: 'その他' },
    pubCityPh: { zh: '如：深圳 / 武汉', en: 'e.g. Shenzhen / Wuhan', ja: '例：深セン / 武漢' },
    pubModeVoice: { zh: '🎙 语音优先（推荐）', en: '🎙 Voice first (recommended)', ja: '🎙 音声優先（推奨）' },
    pubModeVideo: { zh: '📹 视频', en: '📹 Video', ja: '📹 ビデオ' },
    pubNotePh: { zh: '如：今晚想练结构化，互评互改', en: 'e.g. Practicing structured interview tonight, review each other', ja: '例：今夜は構造化面接を練習、相互評価' },
    pubOk: { zh: '意图已发布，等对方来申请', en: 'Intent posted — waiting for others to apply', ja: '意図を投稿しました。申請を待っています' },
    pubFail: { zh: '发布失败：', en: 'Failed to post: ', ja: '投稿失敗：' },

    // ───────────── 公开大厅 ─────────────
    browseTitle: { zh: '🔍 公开大厅（没有群也能找）', en: '🔍 Public Lobby (find partners even without a group)', ja: '🔍 公開ロビー（グループがなくても探せる）' },
    browseRefresh: { zh: '刷新', en: 'Refresh', ja: '更新' },
    browseNote: { zh: '群里没找到合适的？也能在这里浏览同岗伙伴的开放意图。', en: 'No luck in groups? Browse open intents from same-role partners here.', ja: 'グループで見つからない？同じ職種の相手の公開意図をここで探せます。' },
    browseLoading: { zh: '加载中…', en: 'Loading…', ja: '読み込み中…' },
    browseOwnHint: { zh: '你已发布意图，这里只看别人的。刷新可见新上线的搭子。', en: 'You\'ve posted an intent, so this only shows others. Refresh to see new partners.', ja: '意図を投稿済みなので、ここでは他人のみ表示。更新すると新しい相手が見えます。' },
    browseEmpty: { zh: '还没人发，那你就敢为人先，做第一个吃螃蟹的人。', en: 'No one\'s posted yet — be the first mover.', ja: 'まだ誰も投稿していません。あなたが最初になりましょう。' },
    onlineCount: { zh: '🌐 当前在线发需求 <b>{0}</b> 人', en: '🌐 <b>{0}</b> online now', ja: '🌐 いま <b>{0}</b> 人がオンライン' },
    onlineNow: { zh: '当前在线', en: 'Online now', ja: 'オンライン' },
    activeNow: { zh: '刚刚活跃', en: 'Active recently', ja: '最近アクティブ' },
    minsAgo: { zh: '{0} 分钟前', en: '{0} min ago', ja: '{0}分前' },
    hoursAgo: { zh: '{0} 小时前', en: '{0} hr ago', ja: '{0}時間前' },
    daysAgo: { zh: '{0} 天前', en: '{0} day(s) ago', ja: '{0}日前' },
    justNow: { zh: '刚刚', en: 'Just now', ja: 'たった今' },
    mineTag: { zh: '我的', en: 'Mine', ja: '自分の' },
    delete: { zh: '删除', en: 'Delete', ja: '削除' },
    applyTeam: { zh: '申请组队', en: 'Apply to Pair', ja: '組む申請' },
    modeVoiceShort: { zh: '🎙 语音', en: '🎙 Voice', ja: '🎙 音声' },
    modeVideoShort: { zh: '📹 视频', en: '📹 Video', ja: '📹 ビデオ' },
    applied: { zh: '已申请，等对方同意', en: 'Applied — waiting for their approval', ja: '申請しました。相手の同意待ち' },
    applyFail: { zh: '申请失败：', en: 'Apply failed: ', ja: '申請失敗：' },
    delIntentConfirm: { zh: '确定删除这条意图？', en: 'Delete this intent?', ja: 'この意図を削除しますか？' },
    delDone: { zh: '已删除', en: 'Deleted', ja: '削除しました' },
    delFail: { zh: '删除失败：', en: 'Delete failed: ', ja: '削除失敗：' },

    // ───────────── 我的筛选状态 ─────────────
    myStatus: { zh: '📊 我的筛选状态', en: '📊 My Screening Status', ja: '📊 自分の選考状況' },
    mineBoard: { zh: '📋 我发布的需求', en: '📋 My Posted Intents', ja: '📋 投稿した意図' },
    inboxTitle: { zh: '📨 收到的申请', en: '📨 Received Applications', ja: '📨 受け取った申請' },
    outTitle: { zh: '📤 我发出的申请', en: '📤 My Applications', ja: '📤 送った申請' },
    mineEmpty: { zh: '还没有。发布意图后，你的申请情况会出现在这里。', en: 'Nothing yet. After you post an intent, its applications show here.', ja: 'まだありません。意図を投稿すると申請状況がここに表示されます。' },
    inboxEmpty: { zh: '还没人申请你——好搭子，值得等。', en: 'No applications yet — a good partner is worth the wait.', ja: 'まだ申請はありません。良い相手は待つ価値があります。' },
    outEmpty: { zh: '你还没主动找过谁——敢开口的人，先被听见。', en: 'You haven\'t reached out yet — those who dare to speak get heard first.', ja: 'まだ誰にも申請していません。声を上げる人から聞かれます。' },
    loadFail: { zh: '加载失败，点刷新重试', en: 'Failed to load — tap Refresh to retry', ja: '読み込み失敗。更新をタップ' },
    hasPending: { zh: '有 {0} 个申请等你同意', en: '{0} application(s) awaiting your approval', ja: '同意待ちの申請が{0}件あります' },
    pendingOtherLock: { zh: '⏳ 该意图已同意别的申请，等对方都点头', en: '⏳ Another application on this intent was approved — waiting for them', ja: '⏳ この意図は別の申請を承認済み。相手の同意を待っています' },
    roomDissolvedRematch: { zh: '🔄 原房间已解散，可重新匹配：', en: '🔄 Original room dissolved — you can rematch: ', ja: '🔄 元の部屋は解散。再マッチできます：' },
    rematch: { zh: '重新匹配', en: 'Rematch', ja: '再マッチ' },
    agree: { zh: '同意', en: 'Approve', ja: '同意' },
    reject: { zh: '拒绝', en: 'Decline', ja: '拒否' },
    roomDissolved: { zh: '🏠 房间已解散', en: '🏠 Room dissolved', ja: '🏠 部屋は解散しました' },
    waitThem: { zh: '⏳ 等他也同意', en: '⏳ Waiting for them', ja: '⏳ 相手の同意待ち' },
    withdraw: { zh: '撤回', en: 'Withdraw', ja: '取り下げ' },
    paired: { zh: '🤝 已配对', en: '🤝 Matched', ja: '🤝 マッチ済み' },
    enterRoom: { zh: '进入房间', en: 'Enter Room', ja: '部屋に入る' },
    rejectedTag: { zh: '已拒绝', en: 'Declined', ja: '拒否済み' },
    withdrawnTag: { zh: '已撤回', en: 'Withdrawn', ja: '取り下げ済み' },
    waitingThem: { zh: '⏳ 待对方同意', en: '⏳ Awaiting their approval', ja: '⏳ 相手の同意待ち' },
    peerApproved: { zh: '✅ 对方已同意你！', en: '✅ They approved you!', ja: '✅ 相手が承認しました！' },
    iAgreeToo: { zh: '我也同意', en: 'I Agree Too', ja: '私も同意' },
    matchedDone: { zh: '🤝 已互选成功', en: '🤝 Matched!', ja: '🤝 相互選択完了' },
    beenRejected: { zh: '已被拒绝', en: 'Declined', ja: '拒否されました' },
    withdrawnSelf: { zh: '已撤回', en: 'Withdrawn', ja: '取り下げ済み' },
    mineWaiting: { zh: '⏳ 等待对方申请 · 已有 <b>{0}</b> 人申请', en: '⏳ Waiting for applications · <b>{0}</b> applied', ja: '⏳ 申請待ち · <b>{0}</b>人が申請中' },
    mineWithdraw: { zh: '撤回', en: 'Withdraw', ja: '取り下げ' },
    withdrawIntentConfirm: { zh: '撤回这条意图？', en: 'Withdraw this intent?', ja: 'この意図を取り下げますか？' },
    withdrawDone: { zh: '已撤回', en: 'Withdrawn', ja: '取り下げました' },
    withdrawFail: { zh: '撤回失败：', en: 'Withdraw failed: ', ja: '取り下げ失敗：' },
    minePosting: { zh: '⏳ 发布成功，等待对方申请…', en: '⏳ Posted — waiting for applications…', ja: '⏳ 投稿完了。申請待ち…' },
    withdrawApplyConfirm: { zh: '撤回这条申请？', en: 'Withdraw this application?', ja: 'この申請を取り下げますか？' },
    roomClosedNoEnter: { zh: '房间已解散，无法进入', en: 'Room dissolved — can\'t enter', ja: '部屋は解散しました。入れません' },    noRoomNow: { zh: '当前没有可用房间', en: 'No active room right now', ja: '現在利用可能な部屋がありません' },
    peerLeftCountdown: { zh: '⚠️ 对方已退出组队，房间将在 {0}s 后自动关闭。', en: '⚠️ Your partner left — the room auto-closes in {0}s.', ja: '⚠️ 相手が退出しました。{0}秒後に自動で閉じます。' },
    roomClosed: { zh: '房间已关闭', en: 'Room closed', ja: '部屋を閉じました' },
    ratingSubmittedWait: { zh: '✅ 评价已提交，等待对方完成...', en: '✅ Rating submitted — waiting for your partner…', ja: '✅ 評価を送信しました。相手を待っています…' },
    ratingThanks: { zh: '评价已提交，感谢互评 ⭐', en: 'Rating submitted — thanks for reviewing ⭐', ja: '評価を送信しました。ご協力ありがとうございます ⭐' },
    ratingFail: { zh: '评价失败：', en: 'Failed to submit rating: ', ja: '評価送信失敗：' },
    // app.js 附加键
    pendingOtherLockTitle: { zh: '你已同意了这条意图下的另一个申请，对方也会去同意你。等他点头即进入房间。', en: 'You already approved another application on this intent; they will approve you too. They enter once they approve.', ja: 'この意図では別の申請を承認済みです。相手もあなたを承認します。相手の承認で入室します。' },
    decideAccept: { zh: '已同意，等对方也点头', en: 'Approved — waiting for them to approve too', ja: '同意しました。相手の承認待ち' },
    opFailColon: { zh: '操作失败：', en: 'Operation failed: ', ja: '操作に失敗：' },
    applyPrefix: { zh: '申请', en: 'Application', ja: '申請' },
    matchedEnter: { zh: '已互选，进入房间 🤝', en: 'Matched — entering the room 🤝', ja: '相互選択完了。部屋へ入ります 🤝' },
    agreeFail: { zh: '同意失败：', en: 'Approval failed: ', ja: '同意失敗：' },
    adminNeedKey: { zh: '请先输入管理员密钥', en: 'Enter the admin key first', ja: '管理者キーを入力してください' },
    adminOpFail: { zh: '管理操作失败：', en: 'Admin operation failed: ', ja: '管理操作に失敗：' },
    adminDel: { zh: '删除', en: 'Delete', ja: '削除' },
    adminDelIntentConfirm: { zh: '确定删除意图', en: 'Delete intent', ja: '意図を削除します' },
    adminClearConfirm1: { zh: '⚠️ 将清空全部数据，且不可恢复！\n确定继续？', en: '⚠️ This clears ALL data and is irreversible!\nContinue?', ja: '⚠️ すべてのデータを消去し、元に戻せません！\n続行しますか？' },
    adminClearConfirm2: { zh: '再次确认：真的要一键清空全部数据吗？', en: 'Confirm again: really clear all data?', ja: '再確認：本当にすべてのデータを消去しますか？' },
    adminClearedToast: { zh: '已清空全部数据', en: 'All data cleared', ja: 'すべてのデータを消去しました' },
    adminClearedEmpty: { zh: '已清空', en: 'Cleared', ja: '消去済み' },

    // ───────────── 房间卡片 + 互评 ─────────────
    roomDoneTitle: { zh: '✅ FaceTalk 筛选完成！', en: '✅ FaceTalk screening complete!', ja: '✅ FaceTalkの選考が完了！' },
    roomDoneSub: { zh: '双方都想继续练，就接着对练。', en: 'You both want to continue — keep practicing.', ja: '双方とも続けたいなら、そのまま対練。' },
    roomContinue: { zh: '继续互练 →', en: 'Keep Practicing →', ja: '対練を続ける →' },
    rateTitle: { zh: '⭐ 本次互练评价', en: '⭐ Rate This Practice Session', ja: '⭐ 今回の対練を評価' },
    rateSub: { zh: '互评完成、双方都愿意，才能再约一次。', en: 'Only when both rate and both agree can you book again.', ja: '相互評価が完了し双方合意でのみ再予約できます。' },
    rateScore: { zh: '给对方打分', en: 'Score your partner', ja: '相手を採点' },
    score5: { zh: '5 · 很赞，守时专业', en: '5 · Great, punctual & professional', ja: '5 · 素晴らしい、時間厳守でプロ' },
    score4: { zh: '4 · 不错', en: '4 · Good', ja: '4 · 良い' },
    score3: { zh: '3 · 一般', en: '3 · Okay', ja: '3 · 普通' },
    score2: { zh: '2 · 不太行', en: '2 · Not great', ja: '2 · あまり良くない' },
    score1: { zh: '1 · 割韭菜/瞎搞', en: '1 · Scam / messing around', ja: '1 · 詐欺 / いい加減' },
    rateTags: { zh: '标签（选填，逗号分隔）', en: 'Tags (optional, comma-separated)', ja: 'タグ（任意、カンマ区切り）' },
    rateTagsPh: { zh: '如：守时,点评到位,声音清晰', en: 'e.g. punctual, great feedback, clear voice', ja: '例：時間厳守、フィードバック良い、声が明瞭' },
    rateNext: { zh: '愿意再约一次', en: 'Willing to book again', ja: 'また約束したい' },
    rateSubmit: { zh: '提交评价 →', en: 'Submit Rating →', ja: '評価を送信 →' },
    rateBlockNext: { zh: '🚫 不再匹配此人', en: '🚫 Don\'t match this person again', ja: '🚫 この人と再マッチしない' },
    rateBlockHint: { zh: '勾选后，对方不会再出现在你的看板和收件箱。', en: 'Once checked, they won\'t appear in your dashboard or inbox.', ja: 'チェックすると、相手はあなたのダッシュボードや受信箱に表示されなくなります。' },
    footPrivacy: { zh: '隐私提醒：勿留身份证、住址等敏感信息；连麦走腾讯会议。', en: 'Privacy: never share ID numbers or home addresses; use Tencent Meeting for calls.', ja: 'プライバシー：ID番号や住所などの機密情報を共有しないこと。通話はテンセント会議を利用。' },

    // ───────────── 留言墙 ─────────────
    wallTitle: { zh: '留言墙', en: 'Message Wall', ja: 'メッセージウォール' },
    wallAutoClean: { zh: '7 天自动清理', en: 'Auto-cleared every 7 days', ja: '7日ごとに自動削除' },
    wallManage: { zh: '🗑 管理', en: '🗑 Manage', ja: '🗑 管理' },
    wallSub: { zh: '文明留言，禁止广告与不良信息。为彼此安全，<b>勿留手机号、微信等联系方式</b>，防骗；FaceTalk 仅用于面试筛选，录音阅后即焚。', en: 'Keep it civil, no ads or spam. For everyone\'s safety, <b>don\'t leave phone numbers or WeChat</b>; FaceTalk is only for interview screening and clips self-destruct.', ja: '礼儀正しく、広告・不適切な内容は禁止。安全のため<b>電話番号や微信などの連絡先を書かないで</b>ください。FaceTalkは面接選考専用で、音声は自動消去されます。' },
    wallNamePh: { zh: '昵称（留空为「匿名用户」）', en: 'Nickname (blank = "Anonymous")', ja: 'ニックネーム（空欄は「匿名」）' },
    wallPostBtn: { zh: '✨ 发布留言', en: '✨ Post', ja: '✨ 投稿' },
    wallTextPh: { zh: '说点什么…（例如：今晚想练结构化，求个搭子互评）', en: 'Say something… (e.g. practicing structured interview tonight, need a partner)', ja: '何か書いてください…（例：今夜構造化面接を練習。相手募集中）' },
    wallLoading: { zh: '正在加载留言…', en: 'Loading messages…', ja: 'メッセージ読み込み中…' },
    wallEmpty: { zh: '还没人留言，做第一个说话的人。', en: 'No messages yet — be the first to speak.', ja: 'まだメッセージがありません。最初に話しましょう。' },
    wallUnavailable: { zh: '留言墙暂不可用', en: 'Message wall unavailable', ja: 'メッセージウォールは現在利用できません' },
    wallNetworkErr: { zh: '网络异常，稍后重试', en: 'Network error — try again later', ja: 'ネットワークエラー。後で再試行してください' },
    wallAnon: { zh: '匿名用户', en: 'Anonymous', ja: '匿名ユーザー' },
    wallDelTitle: { zh: '删除', en: 'Delete', ja: '削除' },
    wallSeeOlder: { zh: '查看更早的 {0} 条留言 ▾', en: 'View {0} earlier messages ▾', ja: 'さらに{0}件の過去メッセージを見る ▾' },
    wallNeedText: { zh: '写点内容再发布吧', en: 'Write something first', ja: '内容を入力してください' },
    wallNoContact: { zh: '请勿在留言墙留个人微信或手机号，防骗', en: 'Don\'t leave personal WeChat or phone numbers here — stay safe', ja: '個人の連絡先を書かないでください（安全のため）' },
    wallRateLimit: { zh: '太快啦，{0} 秒后再发', en: 'Too fast — try again in {0}s', ja: '速すぎます。{0}秒後にもう一度' },
    wallDailyLimit: { zh: '今日发帖已达上限，明天再来', en: 'Daily posting limit reached — come back tomorrow', ja: '今日の投稿上限に達しました。また明日' },
    wallBadWord: { zh: '含违规词「{0}」，请修改', en: 'Contains blocked word "{0}" — please edit', ja: '不適切な語「{0}」が含まれています' },
    wallDup: { zh: '这条好像刚发过', en: 'This was just posted', ja: '直前に投稿された内容です' },
    wallEmptyText: { zh: '内容不能为空', en: 'Content can\'t be empty', ja: '内容を入力してください' },
    wallDbNotReady: { zh: '留言墙服务未就绪', en: 'Message wall service not ready', ja: 'サービスが準備できていません' },
    wallPostFail: { zh: '发布失败，请重试', en: 'Failed to post — try again', ja: '投稿失敗。再試行してください' },
    wallPostNetErr: { zh: '网络异常，发布失败', en: 'Network error — post failed', ja: 'ネットワークエラー。投稿失敗' },
    wallAdminPrompt: { zh: '输入管理员密码（与管理后台 ADMIN_KEY / 限流解锁 MS_ADMIN_KEY 一致；都没设时默认 rcj9527）。\n批量管理留言建议用 /admin 后台「留言墙」标签页，更顺手。', en: 'Enter the admin password (same as ADMIN_KEY / rate-limit unlock MS_ADMIN_KEY; default rcj9527 if unset).\nFor batch management use the "Message Wall" tab in /admin.', ja: '管理者パスワードを入力してください（管理用ADMIN_KEY / 制限解除MS_ADMIN_KEYと同じ。未設定なら既定 rcj9527）。\n大量管理は /admin の「メッセージウォール」タブを推奨。' },
    wallNeedAdmin: { zh: '请先点「🗑 管理」并输入口令（或去 /admin 后台「留言墙」标签页批量管理）', en: 'Tap "🗑 Manage" and enter the key first (or use the Message Wall tab in /admin)', ja: '先に「🗑 管理」をタップしてキーを入力してください（または /admin のタブで管理）' },
    wallDelConfirm: { zh: '确定删除这条留言？', en: 'Delete this message?', ja: 'このメッセージを削除しますか？' },
    wallDelFail: { zh: '删除失败，口令可能不对', en: 'Delete failed — the key may be wrong', ja: '削除失敗。キーが違う可能性があります' },

    // ───────────── 页脚 ─────────────
    motherSlogan: { zh: '开口，本身就是一种力量。', en: 'To speak is itself a form of strength.', ja: '話すこと自体が、ひとつの力。' },

    // ───────────── app.js 通用错误 / 系统 ─────────────
    ratePrompt: { zh: '已达频率上限（防刷保护）。如要继续测试，请输入管理员密码：', en: 'Rate limit reached (anti-abuse). To continue testing, enter the admin password:', ja: '頻度制限に達しました（不正防止）。テストを続けるには管理者パスワードを入力：' },
    dbNotBound: { zh: '后端存储正在初始化：请绑定 D1 数据库', en: 'Backend storage initializing: bind the D1 database', ja: 'バックエンドを初期化中：D1データベースをバインドしてください' },
    bannedToast: { zh: '该身份已被封禁', en: 'This identity has been banned', ja: 'このIDは利用停止されています' },
    getIdentityFail: { zh: '无法获取身份，请稍后重试', en: 'Couldn\'t get identity — try again later', ja: 'IDを取得できません。後で再試行してください' },
    roleAuto: { zh: '已自动选中岗位：', en: 'Role auto-selected: ', ja: '職種を自動選択：' },

    // ───────────── pair.html 顶部 / 房间 ─────────────
    pairTitle: { zh: 'FaceTalk · 面试间', en: 'FaceTalk · Practice Room', ja: 'FaceTalk · 面接ルーム' },
    pairTag: { zh: '搭子房间 · 1:1', en: 'Partner Room · 1:1', ja: 'パートナールーム · 1:1' },
    roomInfoTitle: { zh: '🤝 搭子房间', en: '🤝 Partner Room', ja: '🤝 パートナールーム' },
    roomInfoSub: { zh: '双方已互选成功。语音优先、限时互练，结束互评。', en: 'You\'ve matched. Voice first, time-limited practice, then rate each other.', ja: 'マッチ完了。音声優先、時間制限付きの対練、最後に相互評価。' },
    privacyBanner: { zh: '🔒 <b>隐私说明：</b>真人对练的录音<b>仅用于本次互评</b>，双方都评价完成后会<b>立即从服务器删除</b>，本地与服务器都不留存；互评结束、房间解散后，所有对话也随之清除。', en: '🔒 <b>Privacy:</b> recordings are used <b>only for this review</b> and are <b>deleted from the server immediately</b> after both sides rate. After the review and room dissolve, all conversations are cleared.', ja: '🔒 <b>プライバシー：</b>録音は<b>今回の評価のみ</b>に使用し、双方が評価完了すると<b>サーバーから即座に削除</b>されます。評価後、部屋が解散すると会話もすべて消去されます。' },
    roomMetaRep: { zh: '对方信誉', en: 'Partner Reputation', ja: '相手の評価' },
    roomMetaMode: { zh: '模式', en: 'Mode', ja: 'モード' },
    roomMetaRemain: { zh: '剩余时间', en: 'Time Left', ja: '残り時間' },
    meetJoin: { zh: '▶ 一键入会（腾讯会议）', en: '▶ Join (Tencent Meeting)', ja: '▶ 参加（テンセント会議）' },
    copyMeetLink: { zh: '复制会议链接', en: 'Copy Meeting Link', ja: '会議リンクをコピー' },
    peerMeet: { zh: '对方会议：', en: 'Partner meeting: ', ja: '相手の会議：' },
    copyBtn: { zh: '复制', en: 'Copy', ja: 'コピー' },
    peerNoMeet: { zh: '对方未留会议链接，可在腾讯会议里互加后开房，再把链接粘贴给对方。', en: 'Your partner hasn\'t shared a link yet — add each other in Tencent Meeting, then paste your link here.', ja: '相手はまだリンクを共有していません。テンセント会議で相互追加して、リンクを貼りましょう。' },
    peerNoInfo: { zh: '对方还没留联机信息。', en: 'Your partner hasn\'t shared contact info yet.', ja: '相手はまだ連絡情報を共有していません。' },
    peerTencentMeet: { zh: '▶ 对方的腾讯会议（一键入会）', en: '▶ Partner\'s Tencent Meeting (join)', ja: '▶ 相手のテンセント会議（参加）' },
    peerInfo: { zh: '对方：', en: 'Partner: ', ja: '相手：' },
    infoCardTitle: { zh: '🔗 联机信息 / 📡 备选会议号', en: '🔗 Contact Info / 📡 Backup Meeting ID', ja: '🔗 連絡情報 / 📡 予備会議番号' },
    infoCardHint: { zh: '实时语音暂时不稳定？<b class="iv-callout">强烈建议把你的腾讯会议号 / 飞书会议号贴在下方</b>，双方互留后直接入会继续练，对练不中断。', en: 'Voice chat unstable? <b class="iv-callout">We strongly suggest pasting your Tencent Meeting / Feishu Meeting ID below</b> so you can join and keep practicing without interruption.', ja: 'リアルタイム音声が不安定？<b class="iv-callout">テンセント会議・飛書会議の番号を下に貼ることを強くおすすめします</b>。お互いに共有すれば中断せずに対練を続けられます。' },
    infoMine: { zh: '我的联机信息（选填）', en: 'My Contact Info (optional)', ja: '自分の連絡情報（任意）' },
    infoMinePh: { zh: '💡 推荐：腾讯会议 123-456-789 或飞书会议链接 — 互留后直接入会对练', en: '💡 e.g. Tencent Meeting 123-456-789 or a Feishu Meeting link — share it and join directly', ja: '💡 例：テンセント会議 123-456-789 や飛書会議リンク — 共有して直接参加' },
    saveMyInfo: { zh: '保存我的信息', en: 'Save My Info', ja: '自分の情報を保存' },
    infoSaved: { zh: '已保存，对方即将看到', en: 'Saved — your partner will see it soon', ja: '保存しました。相手に表示されます' },
    infoSaveFail: { zh: '保存失败：', en: 'Failed to save: ', ja: '保存失敗：' },
    infoNoContact: { zh: '请只留腾讯会议 / 飞书会议号，勿留个人微信或手机号', en: 'Only share Tencent/Feishu meeting IDs — no personal WeChat or phone numbers', ja: 'テンセント・飛書会議の番号のみ共有可。個人の連絡先は禁止' },
    voiceTip: { zh: '🎙 <strong>语音优先</strong>：先连麦互练结构、互相点评；熟了再开摄像头。点上方按钮即可在腾讯会议里通话。', en: '🎙 <strong>Voice first</strong>: practice structure over a call and give feedback; turn on camera once you\'re comfortable. Use the button above to call in Tencent Meeting.', ja: '🎙 <strong>音声優先</strong>：まず通話で構造を練習し、相互フィードバック。慣れてからカメラを。上のボタンでテンセント会議に通話できます。' },
    reportBtn: { zh: '⚠ 举报对方', en: '⚠ Report Partner', ja: '⚠ 相手を報告' },
    leaveBtn: { zh: '🚪 退出组队', en: '🚪 Leave Team', ja: '🚪 退出' },

    // ───────────── pair.html 试音互评 ─────────────
    voiceCardTitle: { zh: '🎙 试音互评（30–90 秒） <span class="v-badge">2.0</span>', en: '🎙 Voice Tryout & Review (30–90s) <span class="v-badge">2.0</span>', ja: '🎙 ボイス試しと相互評価（30〜90秒） <span class="v-badge">2.0</span>' },
    voiceCollapseSub: { zh: '点击展开 ▾', en: 'Tap to expand ▾', ja: 'タップで展開 ▾' },
    voiceHint2: { zh: '双方各录一段答同一道题，互听互评。<strong>都点「愿意组队」才解锁留言板和联机信息</strong>——不合适就早点各找各的，别互相耽误时间。', en: 'Each of you records an answer to the same question, then listen and review. <strong>Only when you both pick "Willing to Pair" do the message board and contact info unlock</strong> — if it\'s not a fit, move on early.', ja: '同じ質問に対する回答を各自録音し、互いに聴いて評価します。<strong>双方が「組む意思あり」を選んだときだけ掲示板と連絡情報が解放されます</strong>。合わなければ早めに別れましょう。' },
    voiceTopicTag: { zh: '本场题目', en: 'Question', ja: '今回のお題' },
    voiceTopicLoading: { zh: '加载中…', en: 'Loading…', ja: '読み込み中…' },
    voiceStart: { zh: '● 开始录音', en: '● Start Recording', ja: '● 録音開始' },
    voiceStopSubmit: { zh: '■ 停止并提交', en: '■ Stop & Submit', ja: '■ 停止して送信' },
    voiceStopRemain: { zh: '■ 还差 {0}s', en: '■ {0}s left', ja: '■ あと{0}秒' },
    voiceMinHint: { zh: '⏱ 至少录 <strong>30 秒</strong>（最多 90 秒，约满自动停止）。录音只在互评期间临时存在，<strong>双方都评完后立即销毁</strong>，手机和电脑本地都不保存。', en: '⏱ Record at least <strong>30 seconds</strong> (max 90s, auto-stops when full). Clips exist only during the review and are <strong>destroyed once both rate</strong> — nothing is saved locally.', ja: '⏱ 最低<strong>30秒</strong>録音（最大90秒、満タンで自動停止）。音声は評価中のみ一時保存され、<strong>双方が評価完了後に即座に破棄</strong>されます。ローカル保存はありません。' },
    voiceSubmitted: { zh: '✅ 你的试音已提交（<span id="v-mine-dur">--</span>），正在等对方录制…', en: '✅ Your clip is submitted (<span id="v-mine-dur">--</span>), waiting for your partner…', ja: '✅ 音声を送信しました（<span id="v-mine-dur">--</span>）。相手の録音待ち…' },
    voiceRetake: { zh: '🔁 重录一遍', en: '🔁 Re-record', ja: '🔁 録り直し' },
    voiceAppend: { zh: '🎙 追加再录一次', en: '🎙 Add Another Take', ja: '🎙 もう1回追加録音' },
    voiceAppendHint: { zh: '对刚才那段不满意？可再录一段，对方能听到你<b>前后两段</b>试音，挑表现更好的一段当参考。', en: 'Not happy with that take? Record another — your partner hears <b>both clips</b> and uses the better one.', ja: 'さっきの録音に満足できない？もう1回録れます。相手は<b>前後2本</b>を聴けます。' },
    voicePeerAppend: { zh: '🎙 对方正在追加再录一次…（先听 TA 刚才那段）', en: '🎙 Your partner is adding another take… (listen to their first one first)', ja: '🎙 相手が追加録音中…（まず最初の音声を聴いてください）' },
    voiceMineList: { zh: '你录了 {0} 段试音（这是你自己的，可随时回听）：', en: 'You recorded {0} clip(s) (yours, listen anytime):', ja: 'あなたは{0}本録音しました（自分のなのでいつでも再生可）：' },
    voicePlayMine: { zh: '▶ 播放我的第 {0} 段（{1} 秒）', en: '▶ Play my clip #{0} ({1}s)', ja: '▶ 自分の第{0}本を再生（{1}秒）' },
    voicePeerNotReady: { zh: '对方还没录好，稍等…', en: 'Your partner hasn\'t recorded yet — wait a moment…', ja: '相手はまだ録音していません。少しお待ちください…' },
    voicePeerList: { zh: '对方共录了 {0} 段试音，逐段听完再评：', en: 'Your partner recorded {0} clip(s) — listen to all before rating:', ja: '相手は{0}本録音しました。全部聴いてから評価：' },
    voicePlayPeer: { zh: '▶ 播放对方第 {0} 段（{1} 秒）', en: '▶ Play partner clip #{0} ({1}s)', ja: '▶ 相手の第{0}本を再生（{1}秒）' },
    playsLeft: { zh: '还可听 {0} 次', en: '{0} play(s) left', ja: 'あと{0}回再生可' },
    playsUsedUp: { zh: '回听次数已用完', en: 'No plays left', ja: '再生回数を使い切りました' },
    voiceLoadingPlay: { zh: '加载中…', en: 'Loading…', ja: '読み込み中…' },
    voiceReplay: { zh: '▶ 重听这段', en: '▶ Replay', ja: '▶ 再生' },
    voicePlay: { zh: '▶ 播放', en: '▶ Play', ja: '▶ 再生' },
    voiceNoPlays: { zh: '回听次数已用完，请凭印象评价', en: 'No plays left — rate from memory', ja: '再生回数を使い切りました。記憶で評価してください' },
    voiceClipGone: { zh: '录音已销毁', en: 'Clip destroyed', ja: '音声は削除されました' },
    voicePlayFail: { zh: '播放失败：', en: 'Playback failed: ', ja: '再生失敗：' },
    voiceReplayMine: { zh: '▶ 重听我的这段', en: '▶ Replay mine', ja: '▶ 自分のを再生' },
    voiceTapPlay: { zh: '点一下播放器的 ▶ 即可播放', en: 'Tap ▶ on the player to play', ja: 'プレイヤーの ▶ をタップして再生' },
    voiceAppendReviewHint: { zh: '听完后觉得第一段不够好？可再录一段，对方能听到你<b>前后两段</b>试音，挑更好的当参考。', en: 'Think your first take wasn\'t great? Record another — your partner hears <b>both clips</b>.', ja: '最初の録音がイマイチ？もう1回録れます。相手は<b>前後2本</b>を聴けます。' },
    voicePeerReady: { zh: '✅ 对方已录好（{0} 段，共 {1} 秒），录完就能互听互评', en: '✅ Your partner recorded ({0} clip(s), {1}s total) — once you record, you can listen & review', ja: '✅ 相手が録音完了（{0}本、計{1}秒）。録音すれば互聴できます' },
    voiceMineDur: { zh: '{0} 段，共 {1} 秒', en: '{0} clip(s), {1}s total', ja: '{0}本、計{1}秒' },
    voiceAppendingTip: { zh: '🎙 追加录制中：录完这段，对方能听到你前后两段试音，挑更好的当参考。', en: '🎙 Adding a take: after this, your partner hears both clips and uses the better one.', ja: '🎙 追加録音中：この後、相手は前後2本を聴けます。' },
    voiceRetakeConfirm: { zh: '重录会删掉你之前录的全部试音，确定？', en: 'Re-recording deletes all your previous clips. Continue?', ja: '録り直すとこれまでの音声がすべて削除されます。よろしいですか？' },
    voiceRetakeDone: { zh: '已删除，重新录一段吧', en: 'Deleted — record a new one', ja: '削除しました。もう一度録音してください' },
    voiceRetakeDenied: { zh: '对方已经评过了，不能再重录', en: 'Your partner already rated — can\'t re-record', ja: '相手は評価済みのため録り直せません' },
    opFail: { zh: '操作失败', en: 'Operation failed', ja: '操作に失敗しました' },
    voiceWillNotPair: { zh: '婉拒后房间会自动关闭，双方各自去找新伙伴。确定吗？', en: 'Declining will auto-close the room and you both find new partners. Continue?', ja: '辞退すると部屋は自動的に閉じ、双方が新たな相手を探します。よろしいですか？' },
    voiceSubmitDone: { zh: '评价已提交，对方录音已销毁 🔥', en: 'Rating submitted — your partner\'s clip is destroyed 🔥', ja: '評価を送信しました。相手の音声は破棄されました 🔥' },
    voiceSubmitFail: { zh: '提交失败：', en: 'Failed to submit: ', ja: '送信失敗：' },
    voiceVerdictPassed: { zh: '🎉 双方都愿意组队！留言板和联机信息已解锁，去约时间吧。', en: '🎉 You both want to pair! Message board and contact info unlocked — go set a time.', ja: '🎉 双方とも組む意思があります！掲示板と連絡情報が解放されました。' },
    voiceVerdictFail: { zh: '🙅 有一方觉得这次不太合适，房间即将自动关闭，回首页再约下一位就好。', en: '🙅 One side declined — the room will close soon. Go back and find the next partner.', ja: '🙅 どちらかが辞退しました。部屋はまもなく閉じます。ホームで次の相手を探しましょう。' },
    voiceCardTitleDone: { zh: '🎉 已组队', en: '🎉 Paired', ja: '🎉 マッチ成立' },
    voiceCardTitleRejected: { zh: '🙅 有一方婉拒', en: '🙅 One side declined', ja: '🙅 一方が辞退' },
    voiceSubWaitPeer: { zh: '✅ 你的试音已提交，等对方录制…', en: '✅ Clip submitted, waiting for your partner…', ja: '✅ 音声送信済み。相手の録音待ち…' },
    voiceSubWaitRev: { zh: '📨 等对方评价…', en: '📨 Waiting for their rating…', ja: '📨 相手の評価待ち…' },
    revPeerTitle: { zh: '对方给你的评价', en: 'Partner\'s Rating of You', ja: '相手からの評価' },
    revMyTitle: { zh: '你给对方的评价', en: 'Your Rating of Partner', ja: 'あなたが相手に送った評価' },
    revScores: { zh: '表达清晰 {0}/5 · 逻辑结构 {1}/5 · 语速节奏 {2}/5', en: 'Clarity {0}/5 · Logic {1}/5 · Pace {2}/5', ja: '明瞭さ {0}/5 · 論理性 {1}/5 · テンポ {2}/5' },
    revWilling: { zh: '👍 愿意组队', en: '👍 Willing to pair', ja: '👍 組む意思あり' },
    revNotWilling: { zh: '🙅 婉拒', en: '🙅 Declined', ja: '🙅 辞退' },
    vClarity: { zh: '表达清晰', en: 'Clarity', ja: '明瞭さ' },
    vLogic: { zh: '逻辑结构', en: 'Logical Structure', ja: '論理性' },
    vPace: { zh: '语速节奏', en: 'Pace & Rhythm', ja: 'テンポ' },
    vClarity5: { zh: '5 · 很清楚', en: '5 · Very clear', ja: '5 · 非常に明瞭' },
    vClarity4: { zh: '4 · 较清楚', en: '4 · Clear', ja: '4 · 明瞭' },
    vClarity3: { zh: '3 · 一般', en: '3 · Okay', ja: '3 · 普通' },
    vClarity2: { zh: '2 · 有点含糊', en: '2 · A bit unclear', ja: '2 · やや不明瞭' },
    vClarity1: { zh: '1 · 听不太清', en: '1 · Hard to hear', ja: '1 · 聞き取りにくい' },
    vLogic5: { zh: '5 · 层次分明', en: '5 · Well structured', ja: '5 · 構成が明快' },
    vLogic4: { zh: '4 · 较有条理', en: '4 · Organized', ja: '4 · まとまっている' },
    vLogic3: { zh: '3 · 一般', en: '3 · Okay', ja: '3 · 普通' },
    vLogic2: { zh: '2 · 有点乱', en: '2 · A bit messy', ja: '2 · やや乱れ' },
    vLogic1: { zh: '1 · 没有结构', en: '1 · No structure', ja: '1 · 構成なし' },
    vPace5: { zh: '5 · 很稳', en: '5 · Very steady', ja: '5 · とても安定' },
    vPace4: { zh: '4 · 较稳', en: '4 · Steady', ja: '4 · 安定' },
    vPace3: { zh: '3 · 一般', en: '3 · Okay', ja: '3 · 普通' },
    vPace2: { zh: '2 · 偏快/偏慢', en: '2 · Too fast / slow', ja: '2 · 速すぎ/遅すぎ' },
    vPace1: { zh: '1 · 卡顿明显', en: '1 · Frequent pauses', ja: '1 · 詰まりが目立つ' },
    vComment: { zh: '一句话点评（选填，≤100 字）', en: 'One-line comment (optional, ≤100 chars)', ja: '一言コメント（任意、100字以内）' },
    vCommentPh: { zh: '如：开头点题很稳，中间可以再举个例子', en: 'e.g. Strong opening, could add an example in the middle', ja: '例：冒頭の導入が良い。中盤にもう少し具体例を' },
    vWilling: { zh: '👍 愿意组队，继续深聊', en: '👍 Willing to pair, keep talking', ja: '👍 組む意思あり、さらに話したい' },
    vNotWilling: { zh: '🙅 这次不太合适，婉拒', en: '🙅 Not a fit this time, decline', ja: '🙅 今回は合わないので辞退' },
    vSubmitHint: { zh: '提交后对方的录音会<strong>立即从服务器删除</strong>。双方都提交才会互相揭晓评价，避免看着对方的分打分。', en: 'Once submitted, your partner\'s clip is <strong>deleted from the server immediately</strong>. Ratings are revealed only after both submit, so you can\'t copy their score.', ja: '送信すると相手の音声は<strong>サーバーから即座に削除</strong>されます。双方の送信後にのみ評価が公開されます。' },
    vSubmit: { zh: '提交评价 →', en: 'Submit Rating →', ja: '評価を送信 →' },
    vWaitRevTitle: { zh: '📨 你的评价已提交，对方的录音已销毁。正在等对方评价…', en: '📨 Your rating is submitted and their clip is destroyed. Waiting for their rating…', ja: '📨 評価を送信しました。相手の音声は破棄済み。相手の評価待ち…' },
    vWaitRevHint: { zh: '双方都提交后立刻揭晓结果。若两边都点了「愿意组队」，房间功能会自动解锁。', en: 'Results reveal immediately after both submit. If you both pick "willing to pair", the room features unlock automatically.', ja: '双方の送信後に即結果が公開。両方「組む意思あり」なら部屋機能が自動解放されます。' },
    vUploading: { zh: '上传中… {0}%', en: 'Uploading… {0}%', ja: 'アップロード中… {0}%' },
    vTooLarge: { zh: '录音体积偏大，请缩短到 45 秒内重录', en: 'Clip is too large — re-record under 45 seconds', ja: '音声が大きすぎます。45秒以内で録り直してください' },
    vMaxAttempts: { zh: '每段试音最多录 2 次，重录请点「重录一遍」', en: 'Max 2 takes per clip — use "Re-record" to restart', ja: '1本につき最大2回まで。「録り直し」でやり直してください' },
    vUploadFail: { zh: '上传失败：', en: 'Upload failed: ', ja: 'アップロード失敗：' },
    vUploadBroken: { zh: '上传中断：', en: 'Upload interrupted: ', ja: 'アップロード中断：' },
    vTooShort: { zh: '不足 30 秒，请重录', en: 'Under 30 seconds — please re-record', ja: '30秒未満です。録り直してください' },
    vSubmitOk: { zh: '试音已提交 ✅', en: 'Clip submitted ✅', ja: '音声を送信しました ✅' },
    vMin30: { zh: '至少要录 {0} 秒，再来一次', en: 'Record at least {0}s — try again', ja: '最低{0}秒録音してください。もう一度' },
    vNoRecorder: { zh: '当前浏览器不支持录音，请换 Chrome / Safari 最新版', en: 'Recording not supported — use the latest Chrome or Safari', ja: 'このブラウザは録音非対応。最新のChrome / Safariを使ってください' },
    vNoMicPerm: { zh: '没拿到麦克风权限，请在浏览器里允许后重试', en: 'No microphone permission — allow it in the browser and retry', ja: 'マイク権限がありません。ブラウザで許可して再試行してください' },
    vRecInitFail: { zh: '录音初始化失败', en: 'Failed to init recording', ja: '録音の初期化に失敗' },
    vNoSupport: { zh: '不足 30 秒，请重录', en: 'Under 30 seconds — please re-record', ja: '30秒未満です。録り直してください' },
    voiceRejectedClose: { zh: '🙅 试音互评结束，有一方选择不组队，房间将在 {0}s 后自动关闭。', en: '🙅 One side chose not to pair — the room auto-closes in {0}s.', ja: '🙅 一方が組まない選択をしました。{0}秒後に自動で閉じます。' },
    voiceRejectedToast: { zh: '🙅 试音后有一方婉拒，房间即将关闭', en: '🙅 One side declined after the tryout — the room is closing', ja: '🙅 試し後に一方が辞退。部屋が閉じます' },
    peerLeftToast: { zh: '⚠️ 对方已退出组队，房间即将自动关闭', en: '⚠️ Your partner left — the room is closing', ja: '⚠️ 相手が退出しました。部屋が閉じます' },
    ratedAutoClose: { zh: '✅ 互评完成，房间将在 {0}s 后自动解散并清除对话。', en: '✅ Review complete — room dissolves and chats clear in {0}s.', ja: '✅ 評価完了。{0}秒後に部屋が解散し会話が消去されます。' },
    timeUpRate: { zh: '⏰ 时间到，请给搭子打个分吧', en: '⏰ Time\'s up — rate your partner', ja: '⏰ 時間になりました。相手を評価してください' },
    roomExpired: { zh: '⏰ 本次互练时间已到，房间失效。去首页重新发布意图约下一位搭子吧。', en: '⏰ Practice time is up and the room expired. Post a new intent to find the next partner.', ja: '⏰ 対練時間が終了し、部屋は失効しました。ホームで新しい意図を投稿しましょう。' },
    noPermRoom: { zh: '无权限或房间已失效。', en: 'No permission or the room expired.', ja: '権限がないか、部屋が失効しています。' },
    roomClosedToast: { zh: '房间已关闭', en: 'Room closed', ja: '部屋を閉じました' },
    missingPairParam: { zh: '缺少房间参数。', en: 'Missing room parameter.', ja: '部屋パラメータがありません。' },

    // ───────────── pair.html 留言板 ─────────────
    msgBoardTitle: { zh: '💬 留言板', en: '💬 Message Board', ja: '💬 掲示板' },
    msgBoardSub: { zh: '互留文字：约时间、留备用联系方式。每人只能删自己发的留言。', en: 'Leave messages: set a time, share backup contact. You can only delete your own messages.', ja: '連絡事項を書き込めます：時間を決める、予備連絡先を共有。削除できるのは自分の投稿のみ。' },
    msgLoading: { zh: '加载中…', en: 'Loading…', ja: '読み込み中…' },
    msgBurn: { zh: '🔥 阅后即焚', en: '🔥 Burn after reading', ja: '🔥 読んだら消去' },
    msgInputPh: { zh: '写点什么…（💡 也可贴上你的腾讯会议号直接约时间）', en: 'Say something… (💡 paste your Tencent Meeting ID to set a time)', ja: '何か書く…（💡 テンセント会議番号を貼って時間を決めることも）' },
    msgSend: { zh: '发送', en: 'Send', ja: '送信' },
    msgMine: { zh: '我', en: 'Me', ja: '自分' },
    msgPeer: { zh: '搭子', en: 'Partner', ja: '相手' },
    msgDel: { zh: '删除', en: 'Delete', ja: '削除' },
    msgDelConfirm: { zh: '删除这条留言？', en: 'Delete this message?', ja: 'このメッセージを削除しますか？' },
    msgDelFail: { zh: '删除失败', en: 'Failed to delete', ja: '削除失敗' },
    msgEmpty: { zh: '还没有留言，写一句开场白吧。', en: 'No messages yet — write an opening line.', ja: 'まだメッセージがありません。一言どうぞ。' },
    msgRateLimit: { zh: '发送太频繁，稍后再试', en: 'Sending too fast — try again later', ja: '送信が頻繁すぎます。後で再試行' },
    msgSendFail: { zh: '发送失败：', en: 'Failed to send: ', ja: '送信失敗：' },

    // ───────────── pair.html 举报 / 退出 ─────────────
    reportConfirm: { zh: '举报需说明原因（≥5 字），且你必须真的和对方搭过、留过联机信息。确认继续？', en: 'Reporting needs a reason (≥5 chars) and you must have actually practiced and shared contact info. Continue?', ja: '報告には理由（5文字以上）が必要で、実際に対練し連絡情報を共有している必要があります。続行しますか？' },
    reportReasonPrompt: { zh: '请说明举报原因（至少 5 个字）', en: 'Please state the reason (at least 5 characters)', ja: '理由を入力してください（5文字以上）' },
    reportReasonShort: { zh: '请填写至少 5 个字的原因', en: 'Please provide a reason of at least 5 characters', ja: '5文字以上の理由を入力してください' },
    reportDup: { zh: '你已经举报过对方，本次不重复计数', en: 'You already reported them — not counted again', ja: '既に報告済みです。重複カウントはしません' },
    reportBanned: { zh: '已举报，累计 {0}/3 个不同举报人，已封禁', en: 'Reported — {0}/3 different reporters, account banned', ja: '報告しました。{0}/3件の異なる報告で利用停止になりました' },
    reportCount: { zh: '已举报（累计 {0}/3 个不同举报人）', en: 'Reported ({0}/3 different reporters)', ja: '報告しました（異なる報告者 {0}/3）' },
    reportNeedContact: { zh: '请先在「联机信息」里填写你的联系方式（证明你真的搭过）', en: 'First fill in your contact info (proof you actually practiced)', ja: '先に「連絡情報」を入力してください（実際に対練した証拠として）' },
    reportNotActive: { zh: '双方未完成配对，无法举报', en: 'Pairing not complete — can\'t report', ja: 'マッチ未完了のため報告できません' },
    reportRateLimit: { zh: '操作太频繁，1 分钟后再试', en: 'Too frequent — try again in 1 minute', ja: '頻度が高すぎます。1分後に再試行' },
    reportFail: { zh: '举报失败：', en: 'Report failed: ', ja: '報告失敗：' },
    leaveConfirm: { zh: '退出后本组队结束，可去首页找新伙伴。确定退出？', en: 'Leaving ends this pairing — you can find a new partner on the homepage. Leave?', ja: '退出するとこのマッチは終了します。ホームで新しい相手を探せます。退出しますか？' },
    leaveDone: { zh: '已退出组队，去首页找新伙伴 👋', en: 'Left the team — find a new partner on the homepage 👋', ja: '退出しました。ホームで新しい相手を探しましょう 👋' },
    leaveRateLimit: { zh: '操作太频繁，稍后再试', en: 'Too frequent — try again later', ja: '頻度が高すぎます。後で再試行' },
    leaveAlreadyRated: { zh: '你已评过分，无需退出', en: 'You\'ve already rated — no need to leave', ja: '評価済みのため退出は不要です' },
    leaveNotActive: { zh: '本组队已结束', en: 'This pairing has ended', ja: 'このマッチは終了しました' },
    leaveFail: { zh: '退出失败：', en: 'Failed to leave: ', ja: '退出失敗：' },

    // ───────────── pair.html 面试间（interview）────────────
    ivCardTitle: { zh: '🎤 面试间 <span class="v-badge">2.1</span>', en: '🎤 Interview Room <span class="v-badge">2.1</span>', ja: '🎤 面接ルーム <span class="v-badge">2.1</span>' },
    ivCollapseSub: { zh: '🚧 功能测试中 · 实时语音 + 转写 + AI 评价链路不稳定', en: '🚧 In testing · live voice + transcription + AI review are unstable', ja: '🚧 テスト中 · リアルタイム音声＋文字起こし＋AI評価は不安定' },
    ivCollapseHint: { zh: '点击展开 ▸', en: 'Tap to expand ▸', ja: 'タップで展開 ▸' },
    ivCollapseClose: { zh: '点击折叠 ▾', en: 'Tap to collapse ▾', ja: 'タップで折りたたむ ▾' },
    ivSetRow: { zh: '🛠 面试间功能未开放，先在这里配置接口备用：', en: '🛠 Interview Room not open yet — configure your API here:', ja: '🛠 面接ルームはまだ未開放。先にここでAPIを設定：' },
    ivOpenSettings: { zh: '🎙 打开 AI 设置（自备 Key）→', en: '🎙 Open AI Settings (bring your own key) →', ja: '🎙 AI設定を開く（ご自身のKey）→' },
    ivTestingMark: { zh: '🚧 功能测试中', en: '🚧 In testing', ja: '🚧 テスト中' },
    ivTestingBanner: { zh: 'WebRTC 实时语音 + 转写 + AI 评价链路尚未稳定，<b>优先建议先用腾讯会议对练</b>，稳定后这栏会自动恢复。', en: 'The WebRTC voice + transcription + AI review chain isn\'t stable yet — <b>we recommend Tencent Meeting for now</b>. This section will recover once stable.', ja: 'WebRTC音声＋文字起こし＋AI評価はまだ安定していません。<b>まずはテンセント会議での対練を推奨</b>します。安定すればこの欄は自動復旧します。' },
    ivMainHint: { zh: '进房即用，<b>跟随搭子房间总时长（单场上限 20 分钟）</b>，时间到自动 AI 评价。每一方用自己设备的麦克风<b>本地录音转文字</b>，实时拼成对话稿；结束用你自己配置的大模型给出结构化评价。<b>⚠ 录音 / 实时语音 / AI 评价按钮当前为测试态，可能不稳定，请优先用腾讯会议；网页语音仅作短时试音/破冰，超过 20 分钟请跳转腾讯会议 / 飞书会议继续对练。</b>', en: 'Ready to use on entry, <b>following the partner room timer (max 20 min/session)</b>; AI review auto-runs when time\'s up. Each side uses their own mic to <b>transcribe locally</b> into a shared transcript; at the end your own LLM produces a structured review. <b>⚠ Recording / live voice / AI review are currently in testing and may be unstable — prefer Tencent Meeting; use web voice for short ice-breaking only. For sessions over 20 minutes, move to Tencent / Feishu Meeting.</b>', ja: '入室ですぐ使用可能。<b>パートナールームの残り時間に連動（1回最大20分）</b>、時間切れで自動AI評価。各端は自分のマイクで<b>ローカル文字起こし</b>し、会話稿を共有。終了時に設定したLLMが構造化評価を出力。<b>⚠ 録音・リアルタイム音声・AI評価は現在テスト段階で不安定な可能性あり。テンセント会議を優先。20分超の対練はテンセント・飛書会議へ移動してください。</b>' },
    ivEndBtn: { zh: '⏹ 结束并 AI 评价', en: '⏹ End & AI Review', ja: '⏹ 終了してAI評価' },
    ivSttOff: { zh: '🎙 录音转文字：关', en: '🎙 Transcribe: Off', ja: '🎙 文字起こし：オフ' },
    ivSttOn: { zh: '🎙 录音转文字：开', en: '🎙 Transcribe: On', ja: '🎙 文字起こし：オン' },
    ivCallBtn: { zh: '🔊 实时语音', en: '🔊 Live Voice', ja: '🔊 リアルタイム音声' },
    ivCallConnecting: { zh: '🔊 实时语音：连接中…', en: '🔊 Live Voice: connecting…', ja: '🔊 リアルタイム音声：接続中…' },
    ivCallConnected: { zh: '🔊 实时语音：已连通', en: '🔊 Live Voice: connected', ja: '🔊 リアルタイム音声：接続済み' },
    ivAnswerCall: { zh: '🔊 接听对方语音', en: '🔊 Answer their call', ja: '🔊 相手の音声に応答' },
    ivFieldHint: { zh: '点「🔊 实时语音」可立即连麦对练；点「🎙 录音转文字」自动把麦克风转成对话稿；没配大模型也能用（手动记笔记），配后才有「AI 评价」。点本栏「🎙 打开 AI 设置（自备 Key）」设好你自己的接口。', en: 'Tap "🔊 Live Voice" to call immediately; tap "🎙 Transcribe" to auto-convert your mic into the transcript; you can use it without an LLM (manual notes), and "AI Review" appears once configured. Set up your own API via "🎙 Open AI Settings".', ja: '「🔊 リアルタイム音声」で即通話、「🎙 文字起こし」でマイクを会話稿に自動変換。LLM未設定でも利用可（手動メモ）。設定後に「AI評価」が使えます。「🎙 AI設定を開く」から設定してください。' },
    ivTranscriptEmpty: { zh: '对话稿会实时显示在这里。开启「录音转文字」后，你说的话会自动变成文字。', en: 'The transcript will show here in real time. Turn on "Transcribe" and your speech auto-becomes text.', ja: '会話稿がここにリアルタイム表示されます。「文字起こし」をオンにすると発言が自動で文字化されます。' },
    ivNotePh: { zh: '手动补充一句（回车发送，记为「我」）', en: 'Add a line manually (Enter to send, marked as "Me")', ja: '手動で一言（Enterで送信、「自分」として記録）' },
    ivNoteSend: { zh: '记', en: 'Add', ja: '記録' },
    ivSending: { zh: '发送失败', en: 'Failed to send', ja: '送信失敗' },
    ivRetry: { zh: '🔄 重发', en: '🔄 Retry', ja: '🔄 再送' },
    ivSendFailReason: { zh: '发送失败：', en: 'Failed to send: ', ja: '送信失敗：' },
    ivTimeout: { zh: '10 秒没回应，可能网络不通', en: 'No response in 10s — network may be down', ja: '10秒応答なし。ネットワーク不通の可能性' },
    ivNetErr: { zh: '网络出错，消息未送达', en: 'Network error — message not delivered', ja: 'ネットワークエラー。メッセージ未達' },
    ivPollBroken: { zh: '对话稿轮询中断，对方消息可能拉不到了（看 F12 Console）', en: 'Transcript polling interrupted — partner messages may not load (check F12 Console)', ja: '会話稿の取得が中断。相手のメッセージが表示されない可能性（F12コンソール参照）' },
    ivNeedSet: { zh: '⚙ 尚未配置：{0}。点右上角 ⚙ 填写你自己的接口（仅存本机）。', en: '⚙ Not configured: {0}. Tap ⚙ in the top-right to add your own API (stored locally).', ja: '⚙ 未設定：{0}。右上の ⚙ からご自身のAPIを設定してください（ローカル保存）。' },
    ivNeedLlm: { zh: '大模型', en: 'LLM', ja: '大規模言語モデル' },
    ivNeedStt: { zh: '语音转文字', en: 'Speech-to-text', ja: '音声文字起こし' },
    ivTimeUp: { zh: '⏰ 时间到', en: '⏰ Time\'s up', ja: '⏰ 時間になりました' },
    ivTimeUpEval: { zh: '时间到 — 点「结束并 AI 评价」可在配置模型后生成点评', en: 'Time\'s up — tap "End & AI Review" to generate feedback once configured', ja: '時間になりました。「終了してAI評価」で設定後に評価を生成できます' },
    ivConfirmEnd: { zh: '结束本场面试并生成 AI 评价？结束后会停止录音。', en: 'End this session and generate AI review? Recording will stop.', ja: 'このセッションを終了しAI評価を生成しますか？録音は停止します。' },
    ivNoLlm: { zh: '未配置大模型，无法生成评价；点 ⚙ 设置后可重跑', en: 'No LLM configured — can\'t generate review; configure via ⚙ then retry', ja: 'LLM未設定のため評価を生成できません。⚙ から設定して再実行' },
    ivNoLines: { zh: '还没有对话稿，无法评价', en: 'No transcript yet — can\'t review', ja: '会話稿がないため評価できません' },
    ivEvalLoading: { zh: '🤖 大模型评价生成中…', en: '🤖 Generating AI review…', ja: '🤖 AI評価を生成中…' },
    ivEvalErr: { zh: '评价失败：', en: 'Review failed: ', ja: '評価失敗：' },
    ivEvalReqErr: { zh: '评价请求出错', en: 'Review request failed', ja: '評価リクエストエラー' },
    ivEvalTitle: { zh: '🤖 AI 面试评价', en: '🤖 AI Interview Review', ja: '🤖 AI面接評価' },
    ivEvalRawTitle: { zh: '🤖 AI 评价', en: '🤖 AI Review', ja: '🤖 AI評価' },
    ivEvalAdvice: { zh: '💡 给你的改进建议', en: '💡 Suggestions for improvement', ja: '💡 改善のためのアドバイス' },
    ivEvalAgain: { zh: '重新评价', en: 'Re-review', ja: '再評価' },
    ivSttNeedSetup: { zh: '请先点右上角 ⚙ 开启录音转文字', en: 'First tap ⚙ in the top-right to enable transcription', ja: '先に右上の ⚙ で文字起こしを有効にしてください' },
    ivSttNeedCfg: { zh: '请先点右上角 ⚙ 配置 Whisper 兼容接口', en: 'First tap ⚙ in the top-right to configure a Whisper-compatible API', ja: '先に右上の ⚙ でWhisper互換APIを設定してください' },
    ivNoMediaRec: { zh: '当前浏览器不支持 MediaRecorder，请改用「浏览器自带」模式', en: 'MediaRecorder unsupported — use "Browser built-in" mode', ja: 'このブラウザはMediaRecorder非対応。「ブラウザ標準」モードを使ってください' },
    ivSttOnApi: { zh: '🎙 已开启录音转文字（API）', en: '🎙 Transcription on (API)', ja: '🎙 文字起こしをオン（API）' },
    ivSttOnBrowser: { zh: '🎙 已开启浏览器自带转文字（Chrome / Edge）', en: '🎙 Browser transcription on (Chrome / Edge)', ja: '🎙 ブラウザ標準の文字起こしをオン（Chrome / Edge）' },
    ivSttStartFail: { zh: '浏览器语音识别启动失败', en: 'Failed to start browser speech recognition', ja: 'ブラウザ音声認識の起動に失敗' },
    ivSttErr: { zh: '浏览器语音识别出错：{0}（检查麦克风权限）', en: 'Browser speech recognition error: {0} (check mic permission)', ja: 'ブラウザ音声認識エラー：{0}（マイク権限を確認）' },
    ivSttRecFail: { zh: '录音初始化失败', en: 'Failed to init recording', ja: '録音の初期化に失敗' },
    ivSttNoMic: { zh: '没拿到麦克风权限，请在浏览器允许', en: 'No microphone permission — allow it in the browser', ja: 'マイク権限がありません。ブラウザで許可してください' },
    ivSttNoSupport: { zh: '当前浏览器拿不到麦克风，无法启用浏览器自带转录', en: 'No mic access — can\'t use browser transcription', ja: 'マイクにアクセスできないためブラウザ文字起こしは使えません' },
    ivSttNoSR: { zh: '当前浏览器不支持 SpeechRecognition，请改 Chrome / Edge 或用 API 模式', en: 'SpeechRecognition unsupported — use Chrome/Edge or API mode', ja: 'SpeechRecognition非対応。Chrome/EdgeかAPIモードを使ってください' },
    ivTransFail: { zh: '转写失败：{0}（检查接口/配额）', en: 'Transcription failed: {0} (check API/quota)', ja: '文字起こし失敗：{0}（API・クォータを確認）' },
    ivTransReqErr: { zh: '转写请求出错', en: 'Transcription request failed', ja: '文字起こしリクエストエラー' },
    ivCallIncoming: { zh: '📞 对方发起了实时语音 —— 点上面的「🔊 实时语音」接听', en: '📞 Your partner started a live call — tap "🔊 Live Voice" above to answer', ja: '📞 相手がリアルタイム音声を開始 — 上の「🔊 リアルタイム音声」で応答' },
    ivCallIncomingToast: { zh: '📞 对方发起了实时语音', en: '📞 Your partner started a live call', ja: '📞 相手がリアルタイム音声を開始' },
    ivCallDisconnected: { zh: '语音断开了，多半是网络波动 —— 再点一次可重连', en: 'Call dropped — likely network fluctuation; tap again to reconnect', ja: '音声が切断されました。ネットワーク変動の可能性。もう一度タップで再接続' },
    ivCallNoDirect: { zh: '直连没打通（双方网络限制较严）—— 一方切 4G/5G 重试多半能成；不想折腾就往下滑到「📡 备选会议号」交换腾讯会议号，转录和 AI 点评照常可用', en: 'Direct connection failed (strict networks) — try 4G/5G on one side; or scroll to "📡 Backup Meeting ID" to exchange Tencent Meeting IDs (transcription & AI review still work)', ja: '直接接続に失敗（双方のネットワーク制限が厳しい）— 片方が4G/5Gで再試行；または「📡 予備会議番号」までスクロールしてテンセント会議番号を交換（文字起こし・AI評価は引き続き利用可）' },
    ivCallNoPublic: { zh: '当前网络拿不到公网地址（校园网 / 公司内网常见），直连打不通 —— 一方切 4G/5G 重试，或往下滑到「📡 备选会议号」交换腾讯会议号，转录和 AI 点评照常可用', en: 'No public IP available (common on campus/corporate networks) — try 4G/5G on one side, or scroll to "📡 Backup Meeting ID" to exchange Tencent Meeting IDs (transcription & AI review still work)', ja: 'パブリックIPを取得できない（学内・社内ネットワークで多い）。片方が4G/5Gで再試行、または「📡 予備会議番号」でテンセント会議番号を交換（文字起こし・AI評価は利用可）' },
    ivCallNoMic: { zh: '当前浏览器拿不到麦克风 —— 微信/QQ 内置浏览器常被限制，请用手机自带浏览器或 Chrome 打开本页', en: 'No mic access — WeChat/QQ built-in browsers often block it; open this page in your phone browser or Chrome', ja: 'マイクにアクセスできません — 微信/QQ内蔵ブラウザでは制限されることが多いです。スマホのブラウザかChromeで開いてください' },
    ivCallMicDenied: { zh: '麦克风权限被拒绝 —— 请在浏览器地址栏左侧允许麦克风后重试', en: 'Mic permission denied — allow the mic next to the address bar and retry', ja: 'マイク権限が拒否されました。アドレスバー横から許可して再試行' },
    ivCallNoMic2: { zh: '拿不到麦克风（微信内置浏览器常被限制），请换手机自带浏览器，或改用腾讯会议链接', en: 'Can\'t access mic (common in WeChat browser) — use your phone browser or a Tencent Meeting link', ja: 'マイクにアクセスできません（微信内蔵ブラウザで多い）。スマホブラウザかテンセント会議リンクを使ってください' },
    ivWebRtcUnsupported: { zh: '浏览器不支持 WebRTC', en: 'WebRTC not supported in this browser', ja: 'このブラウザはWebRTC非対応' },
    ivOfferFail: { zh: '生成 offer 失败', en: 'Failed to create offer', ja: 'offerの生成に失敗' },
    ivCall30s: { zh: '⌛ 30 秒还没连上，建议填一下会议号、走腾讯会议或飞书会议继续练', en: '⌛ Not connected in 30s — consider filling a meeting ID and continuing via Tencent/Feishu Meeting', ja: '⌛ 30秒で接続できません。会議番号を入力し、テンセント・飛書会議で続けることをおすすめします' },
    ivFallbackTitle: { zh: '📡 备选会议号（连不上时改走腾讯会议 / 飞书会议）', en: '📡 Backup Meeting ID (use Tencent / Feishu Meeting if connection fails)', ja: '📡 予備会議番号（接続できないときはテンセント・飛書会議へ）' },
    ivFbStatusNone: { zh: '未填', en: 'Not filled', ja: '未入力' },
    ivFbStatusMine: { zh: '你已填 · 等对方', en: 'Filled by you · waiting for partner', ja: 'あなたは入力済み · 相手待ち' },
    ivFbStatusPeer: { zh: '对方已填 · 你未填', en: 'Filled by partner · not by you', ja: '相手は入力済み · あなたは未入力' },
    ivFbStatusBoth: { zh: '双方都填好了 ✅', en: 'Both filled ✅', ja: '双方入力済み ✅' },
    ivFbHint: { zh: 'WebRTC 在双方都是校园网 / 公司内网 / 部分 4G 环境下打不通。把你们俩各自常用的会议号贴在下面，<b>对方只能看到对方那一面的</b>，互不干扰。录音转文字和 AI 评价照常可用。', en: 'WebRTC often fails on campus/corporate networks and some 4G. Paste your usual meeting IDs below — <b>each side only sees the other\'s</b>. Transcription and AI review still work.', ja: 'WebRTCは学内・社内ネットワークや一部4Gで繋がらないことがあります。各自の会議番号を下に貼ってください。<b>相手には相手の分だけ表示</b>されます。文字起こしとAI評価は利用可能です。' },
    ivFbReminder: { zh: '⚠️ 实时语音没连上？在这里填你的<b>腾讯会议号</b>或<b>飞书会议号</b>，发给对方，约个外部会议继续练 —— 转录和 AI 点评照常可用。', en: '⚠️ Can\'t connect? Fill in your <b>Tencent Meeting</b> or <b>Feishu Meeting</b> ID here and send it to your partner to continue in an external meeting — transcription and AI review still work.', ja: '⚠️ 接続できない？ここに<b>テンセント会議番号</b>か<b>飛書会議番号</b>を入力して相手に送信し、外部会議で続けましょう — 文字起こしとAI評価は利用可。' },
    ivFbTencent: { zh: '我的腾讯会议号', en: 'My Tencent Meeting ID', ja: '自分のテンセント会議番号' },
    ivFbFeishu: { zh: '我的飞书会议号', en: 'My Feishu Meeting ID', ja: '自分の飛書会議番号' },
    ivFbTencentPh: { zh: '如：123-456-789 或会议链接', en: 'e.g. 123-456-789 or a meeting link', ja: '例：123-456-789 や会議リンク' },
    ivFbFeishuPh: { zh: '如：飞书会议链接 / 会议室 ID', en: 'e.g. Feishu meeting link / room ID', ja: '例：飛書会議リンク / 会議室ID' },
    ivFbSave: { zh: '保存我的会议号', en: 'Save My Meeting ID', ja: '自分の会議番号を保存' },
    ivFbAtLeastOne: { zh: '至少填一项', en: 'Fill in at least one', ja: '少なくとも1つ入力してください' },
    ivFbSaved: { zh: '已保存', en: 'Saved', ja: '保存しました' },
    ivFbSaveFail: { zh: '保存失败：', en: 'Failed to save: ', ja: '保存失敗：' },
    ivFbPeerTitle: { zh: '对方提供的会议号', en: 'Meeting IDs from your partner', ja: '相手から提供された会議番号' },
    ivFbPeerTencent: { zh: '📞 腾讯会议：', en: '📞 Tencent Meeting: ', ja: '📞 テンセント会議：' },
    ivFbPeerFeishu: { zh: '📞 飞书会议：', en: '📞 Feishu Meeting: ', ja: '📞 飛書会議：' },
    ivFbPeerNotFilled: { zh: '（未填）', en: '(not filled)', ja: '（未入力）' },

    // ───────────── settings.js 设置弹窗 ─────────────
    setTitle: { zh: '⚙ 设置', en: '⚙ Settings', ja: '⚙ 設定' },
    setTitleConfig: { zh: '⚙ 接口设置', en: '⚙ API Settings', ja: '⚙ API設定' },
    setTabConfig: { zh: '⚙ 接口设置', en: '⚙ API Settings', ja: '⚙ API設定' },
    setTabAbout: { zh: 'ℹ 关于', en: 'ℹ About', ja: 'ℹ 情報' },
    setTip: { zh: '语音转写和 AI 点评需你自己的 API Key，<b>Key 仅保存在本机浏览器</b>，不会上传给任何人。', en: 'Speech-to-text and AI review need your own API key, <b>stored only in this browser</b> — never uploaded.', ja: '文字起こしとAI評価にはご自身のAPI Keyが必要です。<b>Keyはこのブラウザにのみ保存</b>され、誰にも送信されません。' },
    setAsrTitle: { zh: '🎙 语音转写引擎', en: '🎙 Speech-to-Text Engine', ja: '🎙 音声文字起こしエンジン' },
    setAsrBrowser: { zh: '🌐 浏览器内置（免费，部分手机/微信不支持）', en: '🌐 Browser built-in (free, unsupported on some phones/WeChat)', ja: '🌐 ブラウザ標準（無料、一部スマホ/微信で非対応）' },
    setAsrCloud: { zh: '☁️ 云端 API（国内直连·推荐）', en: '☁️ Cloud API (direct access, recommended)', ja: '☁️ クラウドAPI（国内直結・推奨）' },
    setAsrHint: { zh: '浏览器内置无需 Key，但 iOS Safari / 微信内置常无法转写；云端 API 需配置 Key，几乎全平台可用。', en: 'Browser built-in needs no key but often fails on iOS Safari / WeChat; cloud API needs a key and works almost everywhere.', ja: 'ブラウザ標準はKey不要ですがiOS Safari / 微信では動作しないことが多いです。クラウドAPIはKeyが必要でほぼ全環境で使えます。' },
    setApiBase: { zh: 'API Base URL（Whisper 兼容）', en: 'API Base URL (Whisper-compatible)', ja: 'API Base URL（Whisper互換）' },
    setApiKey: { zh: 'API Key', en: 'API Key', ja: 'API Key' },
    setApiKeyPh: { zh: 'sk-...（仅存本机）', en: 'sk-... (stored locally only)', ja: 'sk-...（ローカルのみ保存）' },
    setModel: { zh: '模型名', en: 'Model', ja: 'モデル名' },
    setAsrCloudHint: { zh: '推荐硅基流动 SenseVoice：<code>https://api.siliconflow.cn/v1</code> + <code>FunAudioLLM/SenseVoiceSmall</code>', en: 'Recommended: SiliconFlow SenseVoice — <code>https://api.siliconflow.cn/v1</code> + <code>FunAudioLLM/SenseVoiceSmall</code>', ja: '推奨：SiliconFlow SenseVoice — <code>https://api.siliconflow.cn/v1</code> + <code>FunAudioLLM/SenseVoiceSmall</code>' },
    setLlmTitle: { zh: '🤖 AI 点评', en: '🤖 AI Review', ja: '🤖 AI評価' },
    setLlmEnable: { zh: '✅ 启用 AI 点评', en: '✅ Enable AI review', ja: '✅ AI評価を有効化' },
    setPreset: { zh: '预设', en: 'Preset', ja: 'プリセット' },
    setLlmBase: { zh: 'API Base URL', en: 'API Base URL', ja: 'API Base URL' },
    setLlmKey: { zh: 'API Key（sk- 开头）', en: 'API Key (starts with sk-)', ja: 'API Key（sk- で始まる）' },
    setLlmModelPh: { zh: 'Qwen/Qwen2.5-7B-Instruct 或 deepseek-chat', en: 'Qwen/Qwen2.5-7B-Instruct or deepseek-chat', ja: 'Qwen/Qwen2.5-7B-Instruct や deepseek-chat' },
    setTest: { zh: '🧪 测试连接', en: '🧪 Test Connection', ja: '🧪 接続テスト' },
    setClear: { zh: '清除全部', en: 'Clear All', ja: 'すべてクリア' },
    setSave: { zh: '保存', en: 'Save', ja: '保存' },
    setTutLink: { zh: '📘 <a href="https://exam.955827.xyz/tutorials/api-key.html" target="_blank" rel="noopener">国内大模型免费 API 获取教程</a>', en: '📘 <a href="https://exam.955827.xyz/tutorials/api-key.html" target="_blank" rel="noopener">Free LLM API guide</a>', ja: '📘 <a href="https://exam.955827.xyz/tutorials/api-key.html" target="_blank" rel="noopener">無料LLM APIガイド</a>' },
    setNeedCloudBase: { zh: '已选择「云端 API」转写，必须填写 API Base URL', en: 'You chose "Cloud API" — API Base URL is required', ja: '「クラウドAPI」を選択しました。API Base URLが必要です' },
    setNeedCloudKey: { zh: '已选择「云端 API」转写，必须填写 API Key', en: 'You chose "Cloud API" — API Key is required', ja: '「クラウドAPI」を選択しました。API Keyが必要です' },
    setNeedCloudModel: { zh: '已选择「云端 API」转写，必须填写模型名', en: 'You chose "Cloud API" — model name is required', ja: '「クラウドAPI」を選択しました。モデル名が必要です' },
    setNeedLlmBase: { zh: '已启用 AI 点评，但缺少 API Base URL', en: 'AI review enabled but API Base URL is missing', ja: 'AI評価を有効化しましたがAPI Base URLがありません' },
    setNeedLlmKey: { zh: '已启用 AI 点评，但缺少 API Key', en: 'AI review enabled but API Key is missing', ja: 'AI評価を有効化しましたがAPI Keyがありません' },
    setNeedLlmModel: { zh: '已启用 AI 点评，但缺少模型名', en: 'AI review enabled but model name is missing', ja: 'AI評価を有効化しましたがモデル名がありません' },
    setSaved: { zh: '✅ 已保存（仅本机）', en: '✅ Saved (locally only)', ja: '✅ 保存しました（ローカルのみ）' },
    setClearConfirm: { zh: '清除本机保存的全部接口设置？', en: 'Clear all locally saved API settings?', ja: 'ローカルに保存されたすべてのAPI設定を消去しますか？' },
    setTestNeedBase: { zh: '❌ 请先填 API Base URL', en: '❌ Enter the API Base URL first', ja: '❌ まずAPI Base URLを入力' },
    setTestNeedKey: { zh: '❌ 请先填 API Key', en: '❌ Enter the API Key first', ja: '❌ まずAPI Keyを入力' },
    setTestNeedModel: { zh: '❌ 请先填模型名', en: '❌ Enter the model name first', ja: '❌ まずモデル名を入力' },
    setTestStep1: { zh: '⏳ 第一步：探测 /models ...', en: '⏳ Step 1: probing /models ...', ja: '⏳ ステップ1：/models を確認中 ...' },
    setTestStep2: { zh: '⏳ 第二步：验证 Key+模型 /chat/completions ...', en: '⏳ Step 2: verifying key+model /chat/completions ...', ja: '⏳ ステップ2：Key+モデル /chat/completions を検証中 ...' },
    setTestOk: { zh: '✅ 连接成功！模型回复：', en: '✅ Connected! Model replied: ', ja: '✅ 接続成功！モデルの返答：' },
    setTestEmpty: { zh: '⚠️ 连接成功但返回为空（模型名可能不对）', en: '⚠️ Connected but empty response (model name may be wrong)', ja: '⚠️ 接続成功ですが返答が空（モデル名が違うかも）' },
    setTestNetErr: { zh: '网络失败：请检查 URL 是否以 https:// 开头、本机能否访问外网', en: 'Network failure: check the URL starts with https:// and this device can reach the internet', ja: 'ネットワーク失敗：URLが https:// で始まるか、端末がインターネットに接続できるか確認' },
    setTestTimeout: { zh: '请求超时：请检查 URL 与本机外网连接', en: 'Request timed out: check the URL and internet connection', ja: 'リクエストがタイムアウト：URLとネットワーク接続を確認' },
    // About
    setAboutLead: { zh: 'FaceTalk 不是找人聊天的平台，而是<b>面试群里的智能连接工具</b>。没有量的时候先做工具、借已有的考试群冷启动；等群里每天都有人通过它流转，再自然长成生态。', en: 'FaceTalk isn\'t a chat platform — it\'s a <b>smart connection tool inside interview-prep communities</b>. When there\'s no volume yet, be a tool and cold-start through existing study groups; as people flow through it daily, it grows into an ecosystem.', ja: 'FaceTalkは雑談プラットフォームではなく、<b>面接対策コミュニティのスマート接続ツール</b>です。利用者が少ないうちはツールとして既存の勉強グループで立ち上げ、毎日誰かが使うようになれば自然にエコシステムへ成長します。' },
    setJourneyMeet: { zh: '认识', en: 'Meet', ja: '出会い' },
    setJourneyMeetD: { zh: '考试群里已有一群想练的人', en: 'A study group already has people who want to practice', ja: '勉強グループには練習したい人がすでにいる' },
    setJourneyTry: { zh: '试音', en: 'Tryout', ja: '試し' },
    setJourneyTryD: { zh: '60 秒录音互相听声', en: '60s clips to hear each other', ja: '60秒の録音で互いの声を聴く' },
    setJourneyMatch: { zh: '匹配', en: 'Match', ja: 'マッチ' },
    setJourneyMatchD: { zh: '双方都愿意才组队', en: 'Pair only when both agree', ja: '双方合意でのみ組む' },
    setJourneyGrow: { zh: '成长', en: 'Grow', ja: '成長' },
    setJourneyGrowD: { zh: '互评互练，一起进步', en: 'Review and practice together', ja: '相互評価と対練で共に成長' },
    setAboutCost: { zh: '📉 <b>更低获客成本</b>：群里已在问"有人一起练吗"，你只要说"别私聊了，丢个 FaceTalk 60 秒试音"。', en: '📉 <b>Lower acquisition cost</b>: the group is already asking "anyone up for practice?" — just drop a FaceTalk 60s tryout instead of DMs.', ja: '📉 <b>獲得コスト削減</b>：グループではすでに「誰か練習しない？」と聞かれています。「個別メッセージより、FaceTalkの60秒試しを」と伝えるだけ。' },
    setAboutTrust: { zh: '🛡️ <b>更低信任成本</b>：同群都是冲同一个考试来的，天然同目标、同节点。', en: '🛡️ <b>Lower trust cost</b>: same group = same exam goal, same stage.', ja: '🛡️ <b>信頼コスト削減</b>：同じグループ＝同じ試験目標・同じ段階。' },
    setAboutMatchCost: { zh: '⚡ <b>更低匹配成本</b>：文字尬聊半小时才发现一个考消防一个考教师；60 秒试音直接筛人。', en: '⚡ <b>Lower match cost</b>: don\'t chat 30 minutes to find you\'re aiming at different exams — a 60s tryout filters instantly.', ja: '⚡ <b>マッチングコスト削減</b>：30分文字で話して受験先が違うと気づくより、60秒の試しで即フィルター。' },
    setAboutSafe: { zh: '🔒 双方提交才能互听 · 🕓 录音阅后即焚 · 🚫 严禁留微信 / 手机号，防骗是底线。', en: '🔒 Both submit to hear each other · 🕓 Clips self-destruct · 🚫 No WeChat / phone numbers — safety first.', ja: '🔒 双方提出後にのみ互聴 · 🕓 音声は自動消去 · 🚫 微信・電話番号の共有禁止 — 安全第一。' },
    setAboutLine: { zh: '从「不敢说」到「会表达」，一条线：<b>SoloSpeak</b>（录音练习）→ <b>FaceTalk</b>（真人筛选）→ <b>RCJ Exam Hub</b>（真题刷题 + AI 点评）。', en: 'From "afraid to speak" to "expressing well", one path: <b>SoloSpeak</b> (recording practice) → <b>FaceTalk</b> (real-partner screening) → <b>RCJ Exam Hub</b> (real questions + AI review).', ja: '「話すのが怖い」から「伝えられる」へ、一本道：<b>SoloSpeak</b>（録音練習）→ <b>FaceTalk</b>（リアル相手の選考）→ <b>RCJ Exam Hub</b>（過去問 + AI評価）。' },

    // ───────────── 语言切换器 ─────────────
    langLabel: { zh: '语言', en: 'Language', ja: '言語' },

    // ───────────── 群上下文横幅（?group=）─────────────
    groupBannerPre: { zh: '🎯 你正在为 ', en: '🎯 You are browsing for ', ja: '🎯 あなたは ' },
    groupBannerPost: { zh: ' FaceTalk 面试筛选 · 60 秒试音，找到合适的人', en: ' — FaceTalk interview screening · 60s tryout to find the right partner', ja: ' — FaceTalk 面接選考 · 60秒試しで適切な相手を探す' },

    // ───────────── admin.html 管理后台 ─────────────
    adminTitle: { zh: 'FaceTalk 管理后台', en: 'FaceTalk Admin', ja: 'FaceTalk 管理画面' },
    adminLoginSub: { zh: '输入 ADMIN_KEY 登录', en: 'Login with ADMIN_KEY', ja: 'ADMIN_KEYでログイン' },
    adminKeyPh: { zh: '输入管理员密钥…', en: 'Enter admin key…', ja: '管理者キーを入力…' },
    adminLogin: { zh: '登录', en: 'Login', ja: 'ログイン' },
    adminLoading: { zh: '加载中…', en: 'Loading…', ja: '読み込み中…' },
    adminReqFail: { zh: '请求失败：', en: 'Request failed: ', ja: 'リクエスト失敗：' },
    adminRefreshTip: { zh: '如果一直失败，请按 Ctrl+F5 强制刷新或清除 facetalk.955827.xyz 的服务工作者/缓存。', en: 'If it keeps failing, press Ctrl+F5 to hard-refresh or clear facetalk.955827.xyz\'s service worker/cache.', ja: '失敗が続く場合はCtrl+F5で強制更新するか、facetalk.955827.xyzのサービスワーカー/キャッシュをクリアしてください。' },
    adminLogout: { zh: '退出', en: 'Logout', ja: 'ログアウト' },
    adminStatUsers: { zh: '总用户', en: 'Users', ja: '総ユーザー' },
    adminStatBanned: { zh: '已封禁', en: 'Banned', ja: '利用停止' },
    adminStatIntents: { zh: '总意图', en: 'Intents', ja: '総意図' },
    adminStatOpen: { zh: '开放中', en: 'Open', ja: '公開中' },
    adminStatWalls: { zh: '留言墙', en: 'Wall', ja: 'メッセージ' },
    adminStatReports: { zh: '被举报', en: 'Reports', ja: '報告' },
    adminTabUsers: { zh: '用户', en: 'Users', ja: 'ユーザー' },
    adminTabIntents: { zh: '意图', en: 'Intents', ja: '意図' },
    adminTabWalls: { zh: '留言墙', en: 'Wall', ja: 'メッセージ' },
    adminTabReports: { zh: '举报', en: 'Reports', ja: '報告' },
    adminEmptyUsers: { zh: '暂无用户', en: 'No users', ja: 'ユーザーなし' },
    adminEmptyIntents: { zh: '暂无意图', en: 'No intents', ja: '意図なし' },
    adminEmptyWalls: { zh: '留言墙暂无留言', en: 'No wall messages', ja: 'メッセージなし' },
    adminEmptyReports: { zh: '暂无举报记录', en: 'No reports', ja: '報告なし' },
    adminBanned: { zh: '已封禁', en: 'Banned', ja: '利用停止' },
    adminNormal: { zh: '正常', en: 'Normal', ja: '正常' },
    adminRep: { zh: '信誉', en: 'Rep', ja: '評価' },
    adminReg: { zh: '注册', en: 'Joined', ja: '登録' },
    adminUnban: { zh: '解封', en: 'Unban', ja: '解除' },
    adminBan: { zh: '封禁', en: 'Ban', ja: '停止' },
    adminDelUser: { zh: '删除', en: 'Delete', ja: '削除' },
    adminDelUserConfirm: { zh: '确定删除该用户及其所有意图和申请？此操作不可恢复。', en: 'Delete this user and all their intents & applications? This cannot be undone.', ja: 'このユーザーとその意図・申請をすべて削除しますか？元に戻せません。' },
    adminOpen: { zh: '开放中', en: 'Open', ja: '公開中' },
    adminMatched: { zh: '已匹配', en: 'Matched', ja: 'マッチ済み' },
    adminClosed: { zh: '已关闭', en: 'Closed', ja: '終了' },
    adminExpired: { zh: '已过期', en: 'Expired', ja: '期限切れ' },
    adminOwner: { zh: '发布者', en: 'Owner', ja: '投稿者' },
    adminRole: { zh: '岗位', en: 'Role', ja: '職種' },
    adminCity: { zh: '城市', en: 'City', ja: '都市' },
    adminMode: { zh: '模式', en: 'Mode', ja: 'モード' },
    adminVoice: { zh: '语音', en: 'Voice', ja: '音声' },
    adminDelIntentConfirm: { zh: '确定删除这条意图？', en: 'Delete this intent?', ja: 'この意図を削除しますか？' },
    adminAnon: { zh: '匿名用户', en: 'Anonymous', ja: '匿名' },
    adminRepLine: { zh: '被 {0} 个不同人举报', en: 'Reported by {0} different people', ja: '{0}人の異なるユーザーから報告' },
    adminReportedTimes: { zh: '被举报 {0} 次', en: 'Reported {0} times', ja: '{0}回報告' },
    adminReachBan: { zh: '达封禁线', en: 'Ban threshold', ja: '停止基準に到達' },
    adminNoReason: { zh: '(无原因)', en: '(no reason)', ja: '（理由なし）' },
    adminDanger: { zh: '危险区 · 一键清空', en: 'Danger Zone · Clear All', ja: '危険ゾーン · 全消去' },
    adminDangerDesc: { zh: '删除所有用户、意图、配对、消息、评价数据。不可恢复，仅用于测试重置。', en: 'Deletes all users, intents, pairs, messages and ratings. Irreversible; test reset only.', ja: 'すべてのユーザー・意図・マッチ・メッセージ・評価を削除。元に戻せません。テスト用リセット専用。' },
    adminClearBtn: { zh: '清空全部数据', en: 'Clear All Data', ja: '全データを消去' },
    adminClearPrompt: { zh: '此操作将清空全部数据（用户/意图/配对/消息/评价），不可恢复！\n输入 yes 确认：', en: 'This clears ALL data (users/intents/pairs/messages/ratings). Irreversible!\nType yes to confirm:', ja: 'すべてのデータ（ユーザー/意図/マッチ/メッセージ/評価）を消去します。元に戻せません！\n確認のため yes と入力：' },
    adminCleared: { zh: '已清空 {0} 张表', en: 'Cleared {0} table(s)', ja: '{0}テーブルを消去' },
    adminFail: { zh: '失败', en: 'Failed', ja: '失敗' },
    adminDelWallConfirm: { zh: '确定删除这条留言？', en: 'Delete this message?', ja: 'このメッセージを削除しますか？' },

    // ───────────── pair.html 顶栏 / 房间 ─────────────
    gearUnconfigured: { zh: '未配置', en: 'Not set', ja: '未設定' },
    gearBadgeTitleNoCfg: { zh: '点击 → 语音 & AI 点评设置（自备 Key）', en: 'Tap → Voice & AI review settings (bring your own Key)', ja: 'タップ → 音声 & AI評価設定（Key持参）' },
    gearBadgeTitle: { zh: '语音 & AI 点评设置', en: 'Voice & AI review settings', ja: '音声 & AI評価設定' },
    modeVoiceFirst: { zh: '🎙 语音优先', en: '🎙 Voice-first', ja: '🎙 音声優先' },
    peerLeftCountdown2: { zh: '⚠️ 对方已退出组队，房间将在 {0}s 后自动关闭，对话将清除。', en: '⚠️ Your partner left — the room closes in {0}s and the chat will be cleared.', ja: '⚠️ 相手が退出しました。{0}秒後にルームが閉じ、会話は消去されます。' },
    roomExpiredOrClosed: { zh: '⏰ 房间已过期或已关闭。<br><a href="/">← 返回首页</a>', en: '⏰ This room has expired or closed.<br><a href="/">← Back to home</a>', ja: '⏰ ルームは期限切れまたは終了しました。<br><a href="/">← ホームへ戻る</a>' },

    // ───────────── pair.html 留言板 ─────────────
    msgBurnTag: { zh: '🔥阅后即焚', en: '🔥burn-after-read', ja: '🔥閲覧後消去' },
    msgMine: { zh: '我', en: 'Me', ja: '自分' },
    msgPeer: { zh: '搭子', en: 'Partner', ja: '相手' },
    msgDelConfirm: { zh: '删除这条留言？', en: 'Delete this message?', ja: 'このメッセージを削除しますか？' },
    msgDelFail: { zh: '删除失败', en: 'Delete failed', ja: '削除に失敗' },
    msgEmpty: { zh: '还没有留言，写一句开场白吧。', en: 'No messages yet — leave an opening line.', ja: 'まだメッセージがありません。一言どうぞ。' },
    msgRateLimitPrompt: { zh: '发送太频繁，达到频率上限。请输入管理员密码继续测试：', en: 'Too many messages — rate limit reached. Enter the admin password to continue testing:', ja: '送信が多すぎて制限に達しました。テストを続けるには管理者パスワードを入力：' },
    msgRateLimit: { zh: '发送太频繁，稍后再试', en: 'Too many messages, try again later', ja: '送信が多すぎます。しばらくしてから再試行' },
    msgSendFail: { zh: '发送失败：', en: 'Send failed: ', ja: '送信に失敗：' },

    // ───────────── pair.html 联机信息 / 举报 / 退出 ─────────────
    infoNoContact: { zh: '请只留腾讯会议 / 飞书会议号，勿留个人微信或手机号', en: 'Tencent Meeting / Feishu Meeting IDs only — no WeChat or phone numbers', ja: 'テンセント会議・飛書会議の番号のみ。微信・電話番号は不可' },
    infoSaved: { zh: '已保存，对方即将看到', en: 'Saved — your partner will see it soon', ja: '保存しました。相手にまもなく表示されます' },
    infoSaveFail: { zh: '保存失败：', en: 'Save failed: ', ja: '保存に失敗：' },
    reportConfirm: { zh: '举报需说明原因（≥5 字），且你必须真的和对方搭过、留过联机信息。确认继续？', en: 'Reporting requires a reason (≥5 chars), and you must have actually practiced and shared meeting info with this partner. Continue?', ja: '通報には理由（5文字以上）が必要です。また実際に対練し、会議情報を共有している必要があります。続行しますか？' },
    reportReasonPrompt: { zh: '请说明举报原因（至少 5 个字）', en: 'Please state the reason (at least 5 characters)', ja: '通報理由を入力してください（5文字以上）' },
    reportReasonShort: { zh: '请填写至少 5 个字的原因', en: 'Please write at least 5 characters', ja: '理由は5文字以上で入力してください' },
    reportDup: { zh: '你已经举报过对方，本次不重复计数', en: 'You already reported this partner — not counted again', ja: 'この相手は既に通報済みのため、カウントしません' },
    reportBanned: { zh: '已举报，累计 {0}/3 个不同举报人，已封禁', en: 'Reported — {0}/3 distinct reporters, user banned', ja: '通報受理。{0}/3人の異なる通報者に達し、アカウント停止' },
    reportCount: { zh: '已举报（累计 {0}/3 个不同举报人）', en: 'Reported ({0}/3 distinct reporters)', ja: '通報受理（{0}/3人の異なる通報者）' },
    reportNeedContact: { zh: '请先在「联机信息」里填写你的联系方式（证明你真的搭过）', en: 'First fill in your meeting info under "Connection info" to prove you actually practiced', ja: '先に「接続情報」で会議情報を入力してください（実際に対練した証拠）' },
    reportNotActive: { zh: '双方未完成配对，无法举报', en: 'Pairing not complete — cannot report', ja: 'マッチング未完了のため通報できません' },
    reportRateLimit: { zh: '操作太频繁，1 分钟后再试', en: 'Too many actions, try again in 1 minute', ja: '操作が多すぎます。1分後に再試行' },
    reportFail: { zh: '举报失败：', en: 'Report failed: ', ja: '通報に失敗：' },
    leaveConfirm: { zh: '退出后本组队结束，可去首页找新伙伴。确定退出？', en: 'Leaving ends this pairing — you can find a new partner on the home page. Leave?', ja: '退出するとこの組は終了します。ホームで新しい相手を探せます。退出しますか？' },
    leaveDone: { zh: '已退出组队，去首页找新伙伴 👋', en: 'Left the pairing — find a new partner on the home page 👋', ja: '組を退出しました。ホームで新しい相手を探しましょう 👋' },
    leaveRateLimit: { zh: '操作太频繁，稍后再试', en: 'Too many actions, try again later', ja: '操作が多すぎます。後で再試行' },
    leaveAlreadyRated: { zh: '你已评过分，无需退出', en: 'You already rated — no need to leave', ja: '評価済みのため退出不要です' },
    leaveNotActive: { zh: '本组队已结束', en: 'This pairing has ended', ja: 'この組は終了しました' },
    leaveFail: { zh: '退出失败：', en: 'Leave failed: ', ja: '退出に失敗：' },

    // ───────────── pair.html 试音录音 / 互评 ─────────────
    voiceRejectedClose: { zh: '🙅 试音互评结束，有一方选择不组队，房间将在 {0}s 后自动关闭。', en: '🙅 Tryout review ended — one side chose not to pair. The room closes in {0}s.', ja: '🙅 ボイス試し評価が終了し、片方が組まない選択をしました。{0}秒後にルームが閉じます。' },
    voiceRejectedToast: { zh: '🙅 试音后有一方婉拒，房间即将关闭', en: '🙅 One side declined after the tryout — room closing', ja: '🙅 試し後、片方が辞退。ルームはまもなく閉じます' },
    peerLeftToast: { zh: '⚠️ 对方已退出组队，房间即将自动关闭', en: '⚠️ Your partner left — the room will close automatically', ja: '⚠️ 相手が退出。ルームは自動的に閉じます' },
    ratedAutoClose: { zh: '✅ 互评完成，房间将在 {0}s 后自动解散并清除对话。', en: '✅ Review complete — the room auto-closes in {0}s and the chat is cleared.', ja: '✅ 評価完了。{0}秒後にルームが解散し、会話は消去されます。' },
    timeUpRate: { zh: '⏰ 时间到，请给搭子打个分吧', en: '⏰ Time\'s up — rate your partner', ja: '⏰ 時間になりました。相手を評価しましょう' },
    voicePeerReady: { zh: '✅ 对方已录好（{0} 段，共 {1} 秒），录完就能互听互评', en: '✅ Your partner recorded ({0} clip(s), {1}s total) — review once you finish', ja: '✅ 相手が録音済み（{0}本、計{1}秒）。録り終えたら相互評価できます' },
    voiceMineDur: { zh: '{0} 段，共 {1} 秒', en: '{0} clip(s), {1}s total', ja: '{0}本、計{1}秒' },
    voiceCardTitleDone: { zh: '🎉 已组队', en: '🎉 Matched', ja: '🎉 マッチ成立' },
    voiceCardTitleRejected: { zh: '🙅 有一方婉拒', en: '🙅 One side declined', ja: '🙅 片方が辞退' },
    voiceSubWaitPeer: { zh: '✅ 你的试音已提交，等对方录制…', en: '✅ Your tryout is submitted — waiting for your partner…', ja: '✅ あなたの試し録音を提出しました。相手を待っています…' },
    voiceSubWaitRev: { zh: '📨 等对方评价…', en: '📨 Waiting for your partner\'s review…', ja: '📨 相手の評価を待っています…' },
    voiceVerdictPassed: { zh: '🎉 双方都愿意组队！留言板和联机信息已解锁，去约时间吧。', en: '🎉 You both want to pair! Message board & connection info unlocked — go schedule a session.', ja: '🎉 双方が組むことを希望！メッセージボードと接続情報が解放されました。時間を約束しましょう。' },
    voiceVerdictFail: { zh: '🙅 有一方觉得这次不太合适，房间即将自动关闭，回首页再约下一位就好。', en: '🙅 One side felt it wasn\'t a fit — the room closes soon. Head back and match the next partner.', ja: '🙅 片方が合わないと感じました。ルームはまもなく閉じます。ホームで次の相手を探しましょう。' },
    revPeerTitle: { zh: '对方给你的评价', en: 'Their review of you', ja: '相手からの評価' },
    revMyTitle: { zh: '你给对方的评价', en: 'Your review of them', ja: 'あなたが相手にした評価' },
    revScores: { zh: '表达清晰 {0}/5 · 逻辑结构 {1}/5 · 语速节奏 {2}/5', en: 'Clarity {0}/5 · Logic {1}/5 · Pace {2}/5', ja: '明瞭さ {0}/5 · 論理性 {1}/5 · ペース {2}/5' },
    revWilling: { zh: '👍 愿意组队', en: '👍 Willing to pair', ja: '👍 組む意思あり' },
    revNotWilling: { zh: '🙅 婉拒', en: '🙅 Declined', ja: '🙅 辞退' },
    vNoRecorder: { zh: '当前浏览器不支持录音，请换 Chrome / Safari 最新版', en: 'This browser doesn\'t support recording — use the latest Chrome / Safari', ja: 'このブラウザは録音非対応。最新のChrome / Safariをご利用ください' },
    vNoMicPerm: { zh: '没拿到麦克风权限，请在浏览器里允许后重试', en: 'Microphone access denied — please allow it in the browser and retry', ja: 'マイク権限が取得できませんでした。ブラウザで許可して再試行してください' },
    vRecInitFail: { zh: '录音初始化失败', en: 'Recording failed to initialize', ja: '録音の初期化に失敗' },
    voiceStopRemain: { zh: '■ 还差 {0}s', en: '■ {0}s to go', ja: '■ あと{0}秒' },
    vMin30: { zh: '至少要录 {0} 秒，再来一次', en: 'Record at least {0} seconds, try again', ja: '最低{0}秒の録音が必要です。もう一度' },
    vUploading: { zh: '上传中… {0}%', en: 'Uploading… {0}%', ja: 'アップロード中… {0}%' },
    vTooLarge: { zh: '录音体积偏大，请缩短到 45 秒内重录', en: 'Recording is too large — please re-record within 45 seconds', ja: '音声ファイルが大きすぎます。45秒以内で録り直してください' },
    vMaxAttempts: { zh: '每段试音最多录 2 次，重录请点「重录一遍」', en: 'Up to 2 takes per tryout — use "Re-record" to start over', ja: '試し録音は各1回につき2テイクまで。「録り直す」でやり直せます' },
    vUploadFail: { zh: '上传失败：', en: 'Upload failed: ', ja: 'アップロードに失敗：' },
    vUploadBroken: { zh: '上传中断：', en: 'Upload interrupted: ', ja: 'アップロードが中断：' },
    vTooShort: { zh: '不足 30 秒，请重录', en: 'Under 30 seconds — please re-record', ja: '30秒未満です。録り直してください' },
    vSubmitOk: { zh: '试音已提交 ✅', en: 'Tryout submitted ✅', ja: '試し録音を提出しました ✅' },
    voiceMineList: { zh: '你录了 {0} 段试音（这是你自己的，可随时回听）：', en: 'You recorded {0} clip(s) — yours to replay anytime:', ja: 'あなたは{0}本録音しました（自分のものなのでいつでも再生可）：' },
    voicePlayMine: { zh: '▶ 播放我的第 {0} 段（{1} 秒）', en: '▶ Play my clip #{0} ({1}s)', ja: '▶ 自分の{0}本目を再生（{1}秒）' },
    voicePeerNotReady: { zh: '对方还没录好，稍等…', en: 'Your partner hasn\'t recorded yet — hang tight…', ja: '相手はまだ録音していません。しばらくお待ちください…' },
    voicePeerList: { zh: '对方共录了 {0} 段试音，逐段听完再评：', en: 'Your partner recorded {0} clip(s) — listen to each, then review:', ja: '相手は{0}本録音しました。1本ずつ聴いてから評価してください：' },
    voicePlayPeer: { zh: '▶ 播放对方第 {0} 段（{1} 秒）', en: '▶ Play their clip #{0} ({1}s)', ja: '▶ 相手の{0}本目を再生（{1}秒）' },
    playsLeft: { zh: '还可听 {0} 次', en: '{0} plays left', ja: 'あと{0}回再生可' },
    playsUsedUp: { zh: '回听次数已用完', en: 'No plays left', ja: '再生回数の上限に達しました' },
    voiceLoadingPlay: { zh: '加载中…', en: 'Loading…', ja: '読み込み中…' },
    voiceNoPlays: { zh: '回听次数已用完，请凭印象评价', en: 'No plays left — review from memory', ja: '再生回数の上限です。記憶に基づいて評価してください' },
    voiceClipGone: { zh: '录音已销毁', en: 'Recording destroyed', ja: '録音は消去されました' },
    voicePlayFail: { zh: '播放失败：', en: 'Playback failed: ', ja: '再生に失敗：' },
    voiceTapPlay: { zh: '点一下播放器的 ▶ 即可播放', en: 'Tap ▶ on the player to play', ja: 'プレイヤーの ▶ をタップして再生' },
    voiceReplayMine: { zh: '▶ 重听我的这段', en: '▶ Replay mine', ja: '▶ 自分のを再生' },
    voiceAppendingTip: { zh: '🎙 追加录制中：录完这段，对方能听到你前后两段试音，挑更好的当参考。', en: '🎙 Appending: once done, your partner can hear both clips and pick the better one as reference.', ja: '🎙 追加録音中：録り終えると相手は前後2本を聞けて、良い方を参考にできます。' },
    voiceRetakeConfirm: { zh: '重录会删掉你之前录的全部试音，确定？', en: 'Re-recording deletes all your previous clips. Sure?', ja: '録り直すと以前の試し録音はすべて削除されます。よろしいですか？' },
    voiceRetakeDone: { zh: '已删除，重新录一段吧', en: 'Deleted — record a fresh one', ja: '削除しました。新しく録りましょう' },
    voiceRetakeDenied: { zh: '对方已经评过了，不能再重录', en: 'Your partner already reviewed — cannot re-record', ja: '相手は既に評価済みのため、録り直せません' },
    voiceWillNotPair: { zh: '婉拒后房间会自动关闭，双方各自去找新伙伴。确定吗？', en: 'Declining closes the room and you both find new partners. Sure?', ja: '辞退するとルームは自動的に閉じ、双方が新しい相手を探します。よろしいですか？' },
    voiceSubmitDone: { zh: '评价已提交，对方录音已销毁 🔥', en: 'Review submitted — their recording destroyed 🔥', ja: '評価を提出しました。相手の録音は消去されました 🔥' },

    // ───────────── pair.html 互评等待卡 ─────────────
    waitRevCardTitle: { zh: '⏳ 等待对方评价', en: '⏳ Waiting for their review', ja: '⏳ 相手の評価を待っています' },
    ratingSubmittedWait: { zh: '✅ 评价已提交，等待对方完成...', en: '✅ Review submitted — waiting for your partner…', ja: '✅ 評価を提出しました。相手を待っています…' },
    waitRevHint2: { zh: '双方都提交后会自动揭晓结果。如果超过 3 分钟对方未提交，系统会自动结束并向你单向展示对方信息。', en: 'Results reveal automatically once both submit. If your partner doesn\'t submit within 3 minutes, the system will auto-end and show you their info.', ja: '双方の提出後に自動で結果が公開されます。3分以内に相手が提出しない場合、自動で終了し相手の情報が一方的に表示されます。' },
    ratingThanksShort: { zh: '评价已提交 ⭐', en: 'Review submitted ⭐', ja: '評価を提出しました ⭐' },
    ratingBlocked: { zh: '（已屏蔽此人）', en: '(This person is blocked)', ja: '（この相手をブロックしました）' },
    ratingAlready: { zh: '你已提交过评价 ⭐', en: 'You already submitted a review ⭐', ja: '評価は提出済みです ⭐' },
    ratingFail: { zh: '评价失败：', en: 'Rating failed: ', ja: '評価に失敗：' },

    // ───────────── interview.js 面试间补充 ─────────────
    ivUnknown: { zh: '未知', en: 'unknown', ja: '不明' },
    ivSendFailShort: { zh: '发送失败', en: 'Send failed', ja: '送信失敗' },
    ivSendTimeout: { zh: '10 秒没回应，可能网络不通', en: 'No response in 10s — network may be down', ja: '10秒応答なし。ネットワーク不通の可能性' },
    ivSendNetErr: { zh: '网络出错，消息未送达', en: 'Network error — message not delivered', ja: 'ネットワークエラー — メッセージ未送信' },
    ivNeedCfg: { zh: '请先点右上角 ⚙ 配置 Whisper 兼容接口', en: 'Tap ⚙ in the top-right to configure a Whisper-compatible API first', ja: '右上の ⚙ から Whisper 互換 API を先に設定してください' },
    ivRecFail: { zh: '录音初始化失败', en: 'Recording failed to initialize', ja: '録音の初期化に失敗' },
    ivMicDenied: { zh: '没拿到麦克风权限，请在浏览器允许', en: 'Microphone access denied — allow it in the browser', ja: 'マイク権限がありません。ブラウザで許可してください' },
    ivNoMic: { zh: '当前浏览器拿不到麦克风，无法启用浏览器自带转录', en: 'This browser can\'t access the mic — built-in transcription unavailable', ja: 'このブラウザではマイクにアクセスできず、内蔵文字起こしは使えません' },
    ivNoSR: { zh: '当前浏览器不支持 SpeechRecognition，请改 Chrome / Edge 或用 API 模式', en: 'SpeechRecognition isn\'t supported here — use Chrome / Edge or API mode', ja: 'SpeechRecognition非対応です。Chrome / Edge または API モードを使用' },
    ivSttErrCheck: { zh: '（检查麦克风权限）', en: ' (check mic permission)', ja: '（マイク権限を確認）' },
    ivTransFailCheck: { zh: '（检查接口/配额）', en: ' (check API / quota)', ja: '（API・割当を確認）' },
    ivConnected: { zh: '🔊 实时语音：已连通', en: '🔊 Live voice: connected', ja: '🔊 リアル音声：接続済み' },
    ivDisconnected: { zh: '语音断开了，多半是网络波动 —— 再点一次可重连', en: 'Voice dropped — likely network fluctuation. Tap again to reconnect.', ja: '音声が切断されました。ネットワーク揺らぎの可能性。もう一度タップで再接続' },
    ivNoDirect: { zh: '直连没打通（双方网络限制较严）—— 一方切 4G/5G 重试多半能成；不想折腾就往下滑到「📡 备选会议号」交换腾讯会议号，转录和 AI 点评照常可用', en: 'Direct connection failed (strict networks). One side switching to 4G/5G usually fixes it — or scroll down to "📡 Backup meeting IDs" and swap Tencent Meeting IDs; transcription & AI review still work.', ja: '直接接続が失敗しました（双方のネットワーク制限が厳しい）。片方が4G/5Gに切替えると成功しやすいです。面倒なら「📡 代替会議ID」にスクロールしてテンセント会議IDを交換してください。文字起こしとAI評価は引き続き利用できます。' },
    ivNoPublic: { zh: '当前网络拿不到公网地址（校园网 / 公司内网常见），直连打不通 —— 一方切 4G/5G 重试，或往下滑到「📡 备选会议号」交换腾讯会议号，转录和 AI 点评照常可用', en: 'No public address on this network (common on campus / office). Direct connection fails — switch one side to 4G/5G, or scroll to "📡 Backup meeting IDs" and swap Tencent Meeting IDs; transcription & AI review still work.', ja: 'このネットワークではグローバルIPを取得できません（キャンパス・社内ネットワークでよくあります）。直接接続は失敗します。片方を4G/5Gに切替えるか、「📡 代替会議ID」にスクロールしてテンセント会議IDを交換してください。文字起こしとAI評価は引き続き利用できます。' },
    ivNoMic2: { zh: '当前浏览器拿不到麦克风 —— 微信/QQ 内置浏览器常被限制，请用手机自带浏览器或 Chrome 打开本页', en: 'This browser can\'t access the mic — in-app WeChat/QQ browsers are often restricted. Open this page in your phone\'s browser or Chrome.', ja: 'このブラウザではマイクにアクセスできません。WeChat/QQ内蔵ブラウザは制限されることが多いので、スマホ標準ブラウザまたはChromeで開いてください。' },
    ivMicDenied2: { zh: '麦克风权限被拒绝 —— 请在浏览器地址栏左侧允许麦克风后重试', en: 'Mic permission denied — allow it next to the address bar, then retry', ja: 'マイク権限が拒否されました。アドレスバー左側で許可してから再試行してください' },
    ivNoMic3: { zh: '拿不到麦克风（微信内置浏览器常被限制），请换手机自带浏览器，或改用腾讯会议链接', en: 'Can\'t access the mic (in-app browsers are often restricted) — use your phone\'s browser or a Tencent Meeting link instead', ja: 'マイクにアクセスできません（内蔵ブラウザは制限されることが多い）。スマホ標準ブラウザか、テンセント会議リンクをお使いください' },
    ivConnecting: { zh: '🔊 实时语音：连接中…', en: '🔊 Live voice: connecting…', ja: '🔊 リアル音声：接続中…' },
    ivIncomingToast: { zh: '📞 对方发起了实时语音 —— 点上面的「🔊 实时语音」接听', en: '📞 Your partner started live voice — tap "🔊 Live voice" above to answer', ja: '📞 相手がリアル音声を開始しました — 上の「🔊 リアル音声」をタップして応答' },
    ivFbTencentLabel: { zh: '📞 腾讯会议：', en: '📞 Tencent Meeting: ', ja: '📞 テンセント会議：' },
    ivFbTencentEmpty: { zh: '📞 腾讯会议：（未填）', en: '📞 Tencent Meeting: (not set)', ja: '📞 テンセント会議：（未設定）' },
    ivFbFeishuLabel: { zh: '📞 飞书会议：', en: '📞 Feishu Meeting: ', ja: '📞 飛書会議：' },
    ivFbFeishuEmpty: { zh: '📞 飞书会议：（未填）', en: '📞 Feishu Meeting: (not set)', ja: '📞 飛書会議：（未設定）' },
    ivEvalConvPrefix: { zh: '面试对话稿：\n', en: 'Interview transcript:\n', ja: '面接会話録：\n' },
    ivEvalSys: { zh: '你是辅警/消防/公务员/社区等招录结构化面试的资深考官。请根据下面的双人面试对话稿，从「我」（答题方）的角度给结构化点评。严格用 JSON 输出：{"summary":"一句话总评","scores":[{"dim":"内容切题","score":1-5,"reason":"..."},{"dim":"逻辑结构","score":1-5,"reason":"..."},{"dim":"语言表达","score":1-5,"reason":"..."},{"dim":"岗位匹配度","score":1-5,"reason":"..."},{"dim":"综合表现","score":1-5,"reason":"..."}],"advice":["给「我」的3条最该改进的实操建议"]}。不要输出 JSON 以外的解释文字。',
      en: 'You are a senior examiner for structured interviews for recruitment into the police auxiliary / firefighting / civil service / community roles. Based on the two-person interview transcript below, give a structured review from the perspective of "me" (the candidate answering). Output strictly in JSON: {"summary":"one-line overall verdict","scores":[{"dim":"Relevance","score":1-5,"reason":"..."},{"dim":"Logic","score":1-5,"reason":"..."},{"dim":"Expression","score":1-5,"reason":"..."},{"dim":"Role fit","score":1-5,"reason":"..."},{"dim":"Overall","score":1-5,"reason":"..."}],"advice":["3 practical tips for "me" to improve most"]}. Do not output any text outside the JSON.',
      ja: 'あなたは警察補助・消防・公務員・コミュニティ等の採用における構造化面接のベテラン面接官です。以下の二人の面接会話録に基づき、「自分」（回答者）の視点から構造的な評価を行ってください。必ずJSONのみで出力：{"summary":"一言総評","scores":[{"dim":"内容の適合","score":1-5,"reason":"..."},{"dim":"論理構成","score":1-5,"reason":"..."},{"dim":"言語表現","score":1-5,"reason":"..."},{"dim":"職種マッチ度","score":1-5,"reason":"..."},{"dim":"総合評価","score":1-5,"reason":"..."}],"advice":["「自分」が最も改善すべき実践的アドバイス3つ"]}。JSON以外の説明文は出力しないこと。' },

    // ───────────── settings.js 预设名 ─────────────
    setPresetSilicon: { zh: '硅基流动（推荐 / 国内直连）', en: 'SiliconFlow (recommended / direct CN)', ja: 'SiliconFlow（推奨 / 国内直結）' },
    setPresetDeepseek: { zh: 'DeepSeek', en: 'DeepSeek', ja: 'DeepSeek' },
    setPresetQwen: { zh: '通义千问（DashScope 兼容）', en: 'Qwen (DashScope compatible)', ja: 'Qwen（DashScope互換）' },
    setPresetMoonshot: { zh: 'Kimi (Moonshot)', en: 'Kimi (Moonshot)', ja: 'Kimi (Moonshot)' },
    setPresetOpenai: { zh: 'OpenAI', en: 'OpenAI', ja: 'OpenAI' },
    setPresetCustom: { zh: '自定义（填下面的地址）', en: 'Custom (fill the URL below)', ja: 'カスタム（下のURLを入力）' },

    // ───────────── 相对时间 ─────────────
    timeAgoNow: { zh: '刚刚', en: 'just now', ja: 'たった今' },
    timeAgoMin: { zh: '{0} 分钟前', en: '{0} min ago', ja: '{0}分前' },
    timeAgoHour: { zh: '{0} 小时前', en: '{0} hr ago', ja: '{0}時間前' },
    timeAgoDay: { zh: '{0} 天前', en: '{0} d ago', ja: '{0}日前' },
    setTestStep1Fail: { zh: '（第一步 /models 失败）', en: ' (step 1 /models failed)', ja: '（ステップ1 /models 失敗）' },
    setTestStep2Fail: { zh: '（第二步失败）', en: ' (step 2 failed)', ja: '（ステップ2 失敗）' },
  };

  function detect() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved && LANGS.indexOf(saved) >= 0) return saved;
    } catch (e) {}
    var nav = '';
    try { nav = (navigator.language || '').toLowerCase(); } catch (e) {}
    if (nav.indexOf('ja') === 0) return 'ja';
    if (nav.indexOf('en') === 0) return 'en';
    if (nav.indexOf('zh') === 0) return 'zh';
    return 'zh';
  }

  var lang = detect();
  var listeners = [];

  function fmt(s, args) {
    if (!args || !args.length) return s;
    return String(s).replace(/\{(\d+)\}/g, function (m, i) {
      return args[i] != null ? args[i] : m;
    });
  }

  // 取某语言的文案；缺则回退 zh
  function t(key, args) {
    var e = DICT[key];
    if (!e) return key;
    var v = e[lang] != null ? e[lang] : e.zh;
    return fmt(v, args);
  }

  // 扫描并重写标注节点
  function apply(root) {
    root = root || document;
    if (!root.querySelectorAll) return;
    var i, n, k;
    var nodes = root.querySelectorAll('[data-i18n]');
    for (i = 0; i < nodes.length; i++) { n = nodes[i]; k = n.getAttribute('data-i18n'); if (k) n.textContent = t(k); }
    nodes = root.querySelectorAll('[data-i18n-html]');
    for (i = 0; i < nodes.length; i++) { n = nodes[i]; k = n.getAttribute('data-i18n-html'); if (k) n.innerHTML = t(k); }
    nodes = root.querySelectorAll('[data-i18n-ph]');
    for (i = 0; i < nodes.length; i++) { n = nodes[i]; k = n.getAttribute('data-i18n-ph'); if (k) n.setAttribute('placeholder', t(k)); }
    nodes = root.querySelectorAll('[data-i18n-title]');
    for (i = 0; i < nodes.length; i++) { n = nodes[i]; k = n.getAttribute('data-i18n-title'); if (k) n.setAttribute('title', t(k)); }
    nodes = root.querySelectorAll('[data-i18n-aria]');
    for (i = 0; i < nodes.length; i++) { n = nodes[i]; k = n.getAttribute('data-i18n-aria'); if (k) n.setAttribute('aria-label', t(k)); }
    nodes = root.querySelectorAll('[data-i18n-content]');
    for (i = 0; i < nodes.length; i++) { n = nodes[i]; k = n.getAttribute('data-i18n-content'); if (k) n.setAttribute('content', t(k)); }
  }

  function setLang(l) {
    if (LANGS.indexOf(l) < 0) l = 'zh';
    lang = l;
    try { localStorage.setItem(STORAGE_KEY, l); } catch (e) {}
    try { document.documentElement.setAttribute('lang', LANG_MAP[l]); } catch (e) {}
    var sw = document.getElementById('ft-lang');
    if (sw) sw.value = l;
    apply();
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](l); } catch (e) {} }
  }

  function onChange(cb) { listeners.push(cb); }

  // 构建语言切换下拉，插到 [data-lang-slot] 容器
  function buildSwitcher() {
    var slots = document.querySelectorAll('[data-lang-slot]');
    if (!slots.length) return;
    var i, s;
    for (i = 0; i < slots.length; i++) {
      s = slots[i];
      if (s.querySelector('select')) continue;
      var sel = document.createElement('select');
      sel.id = 'ft-lang';
      sel.className = 'ft-lang';
      sel.setAttribute('aria-label', t('langLabel'));
      var opts = [
        ['zh', '中文'],
        ['en', 'English'],
        ['ja', '日本語']
      ];
      for (var j = 0; j < opts.length; j++) {
        var o = document.createElement('option');
        o.value = opts[j][0];
        o.textContent = opts[j][1];
        if (opts[j][0] === lang) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', function () { setLang(this.value); });
      s.appendChild(sel);
    }
  }

  // 初始化：设 <html lang> + 扫静态节点 + 建切换器
  try { document.documentElement.setAttribute('lang', LANG_MAP[lang]); } catch (e) {}
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { buildSwitcher(); apply(); });
  } else {
    buildSwitcher();
    apply();
  }

  window.FTI18N = {
    t: t,
    apply: apply,
    setLang: setLang,
    getLang: function () { return lang; },
    onChange: onChange,
    LANGS: LANGS,
  };
})();
