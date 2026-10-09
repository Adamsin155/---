// The site's service worker, at the root so its scope covers clients.html (and
// every page). Three jobs and nothing else:
//  0. The site's own files (the pages, scripts, styles, fonts and icons: exactly the
//     list the publish wrote into BUILD below) are kept on the device and answered
//     from there, so a screen opens without waiting for the network (docs/ops.md,
//     section 42). Nothing else is ever stored or answered: a request to another
//     host (the database, the functions, the client's files) is not touched at all,
//     and neither is anything that is not a GET of a listed file. In the repository
//     BUILD is null and this part is off: pages load from the network as before.
//  1. Web Push from the reminder engine (supabase/functions/reminders): each push
//     is JSON { title, body, url, tag } and is always shown (iOS requires it).
//     The tag is the case (pushTag in app/reminder-engine.js), and `renotify` comes
//     with it: the next step of the same case, a repeat of a task given on the spot
//     or the next batch of lateness notes replaces the notification before it and
//     still sounds, so many pushes are few banners.
//  2. Notifications a page shows itself through this registration (the "now" bar
//     on Chrome for Android, where only a service worker may show one).
// A tap opens the page the notification is about, on this site only, or brings
// forward the window already on it. app/push.js registers it (siteWorker()).
const HOME = 'clients.html#mine';

self.addEventListener('install', () => self.skipWaiting());

// ── The site's files, kept on the device ──
// scripts/build-pages.mjs replaces the next line at publish with
// { version, files: { '<path>': '<sha-256 of the file, hex>' } }: every published file.
const BUILD = {"version":"2557724a690a21d0","files":{"access.html":"925bade00174f5809b79c1bcbb874be2bc0eda5b3911c25b38fa4ffa20e89444","app/access-data.js":"3fe9ecf8bd36c04e71fe33b949649fb5f97966c68c6bdc0a13da7ecf553813cc","app/access-form.js":"c603b76260710129758f4ef1f9433ae087f4ac0d3b4d8f4f172288bb5cea5488","app/access-link-ui.js":"8710222a349bfed486b9cd675f7588ae0fd9653e61318e48d5d8121efdf2cf85","app/access-logic.js":"91c92936be8aebc4cf5ace29a67b2facaa11b5ba3809f2149ea3eab10ea54c7f","app/access-nudge.js":"1591ad693817b357068ce891bcead9fa043175c2f95868487b1b0a584d4b3f1a","app/approvals-logic.js":"9a79515750c19c85557482995ff00baafa1f8f4def50ba7912f0f225d17ecdc9","app/approvals-ui.js":"7a6e66cc8b99b22f65f02cc5277fff19b8e1559f1d953375d023caa4a109e50b","app/assets/logo-mark.png":"2cd2f349d456cb9b3ec6296cd9f069f1ffe65d1bcacceff8c878067d812954a4","app/assets/logo.png":"f3449f67c8e000b64f4b70e4e1f4d416b3461f5bac4b3c8bc4bfd281cff826c3","app/auto-assign.js":"07ae54da15b704d647bfceb08322e7dd7aeb0f31566217e5dc8a68484e00905a","app/availability-logic.js":"1923d38721d0fb5ecb61c560b536a47eb8948ed3bc75435fddbc1404a0dc2f91","app/availability-ui.js":"fe8f632a1df437d105e544d16cdf88fe7369fff5785c8f6e560904b398129953","app/briefs.js":"84d702fcfa7640ef1152dba3009a3720e0bc89c888ef5f9d30648b6803a44c88","app/builder.js":"6ec4c789f30da153ca292a7572f7244aa0ed1fa20bcf2f2a3322d9ddeb4bff00","app/calendar-card.js":"bc437675a5b386f2c528580ba5afb19a1067022e60f89cb4b26b3b9717674a55","app/calendar-feed.js":"3b89d9cc0b8ed954e796729d610caa348f6218652c3b5769c44b994f24c18945","app/calendar.js":"d3e9d34c2379728bbdc62d1428db263f97a1c22cb549929d9948c53a2a0e2e28","app/catalog.js":"f3f84fab12be0e9bd272798205918b1bf7d29815cc3de7c679249538e5edf5c1","app/characterization.js":"db72366dbe696d19c75e604cfd62551a50b9cbef68ad04daa3cacb28ba0726d2","app/client-card.js":"c5c3170b15a4d93a5729b59cc4a729e045718eb65c4dbfa1e1fbd3899c544723","app/client-links.js":"3b0b9d9f37fcde761e125f8789ae5a685da13e477b16863528f59481608ae035","app/client-open.js":"6303eecfb0153ec430dbbaf88cd60d3b56448db4086c33d7d3420c4cfa52ff40","app/client.js":"4a46735b73393cfa00a93cd83546068b94ad444019c97bd650a49ac2d5644cc1","app/clients.js":"8db1abc609613182e07b99304341f55c6192bfbfc8d6edcbbbce1a66fba98050","app/clocks.js":"d531ba30b91c52de194b336c0b33eaf00d77c233cd63bbc5f58f286bf5e08618","app/contract-summary.js":"3c60c582f369edc1b75c5e4f555eb1d669d1187ca968786d914e0b29bea0327f","app/control-topics.js":"c5002eda2c1cf7aa26b896e8c3ff807da1f138df7ab2c4d8cdd914e0e2bc0e78","app/dashboard.js":"ac2cfe98710ecad2848b827ae923bf12e217ea854cb9a15347d23e158428fbff","app/day-summary.js":"50251620614374d0d9a09dc3563943d491ea66dc319b7c610ccef8d7b7e4cbac","app/deal-data.js":"5f073e8cb070eb5eee1a8181c59e8472778ec6389002dddb5a89a0d9a22534bf","app/deal-logic.js":"e3de454adc1d7fb2770ae695779b1ef7337d21020fa8bf12daa6265526306573","app/deal-ui.js":"2eb541a8531c558bb9ad44ecacd4c9161a52b887bf86f862117c378897b866ec","app/deal.js":"c2c4e8cd3462a6231690c38bd33e45b850c11bcde01c4a721c23e5041efd4809","app/decisions-logic.js":"b16b2579bd5edcb6be142697e33329e8857ccaecc79fc5b440e7cfb948d8c157","app/decisions.js":"9e64bcdc742bd7c837c1de43268f9556470ced3159ffad4d86baf2c3a8c550a2","app/editor.js":"c10fc625d17769d2fb31cc53f792e98e22bd6e5836d1ab2697ced6dcc678256c","app/feel.js":"59e125c5ec2091ad8745c03d9483be37d259eaf865a897218b02da546c9534da","app/files-logic.js":"0afda0c542718c84160cf7a2ef8e168a5fabe2d55bc88dd34158fa7a4cbb1a4f","app/files-ui.js":"745a428e4ea2f4a3430f7facca52f44b51fde4ea366def8488e6f40fc6e26efb","app/fonts/OFL.txt":"5163e9f9fda30f27c95700c375293baaf841afc890d8a8496113bc954a19ab7f","app/fonts/fonts.css":"84aa1405bf6ad2b9254f23e2afbe389d852308c8c4d8305fa97e9be4d28e2236","app/fonts/heebo-hebrew.woff2":"f1f7cfaef59431c7b391df81fb05520273303840bbe917213a2ab9f41b839675","app/fonts/heebo-latin.woff2":"50dae2e12dae22c920388023e35aaebcd1e1d27bbe915c83d64210377e083e60","app/fonts/jetbrains-mono-latin.woff2":"18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e","app/fonts/rubik-hebrew.woff2":"197b6dbe5c6bec7276c59b02d70a16ee6acd44322fc2f8d0226c07f8d57976c2","app/fonts/rubik-latin.woff2":"691cd1d9b4c0cdf31a1dcf04259c86f92c85e69f6622abab7964d81e36890691","app/fonts/varela-round-hebrew.woff2":"61f49780c3763145a924f538636d2e4aa190d614ea44a190758260896e4d804d","app/fonts/varela-round-latin.woff2":"03871f86c86fc776f89d0cb947502f3957181b63327fecaec724bc39d082319f","app/frame-guard.js":"b6e68dfdeab0aefbd99ae86d6138a4a99fc3e23eefba5cffd373732718a063c9","app/gallery.js":"a1f6ac4cc72ac8abc5a5aa51c7b7e91410a62fee337c535219c200ef98111476","app/gantt-brand.js":"18e775406d5f5421197e8d5f805cfedc220ffe2f1f1279aa6614410ef3dae08f","app/gantt-data.js":"fb0dcd59119161c4cd8addb42637ddf573378a999b18305326bdebdc96a679da","app/gantt-index.js":"1883a378bad91a60e555d18f84636a4bfb09a68300df9b2052b0fb4811c630bf","app/gantt-logic.js":"f535886eaa9cf1ff1e3b5a1d66e0e5b7a69284c1cb65e2e7fc4fef6d72021cae","app/gantt-template.js":"d64560bce00d1a4de816b99f839f07d6e7c9108ea77218ff5240a41a51d1eeed","app/gantt.js":"a004b83d0ebcf842cf40a905c14cf11147608dcd3dea8282ea9ed172675859ed","app/handoff-ui.js":"a61839bec8a9383c34dcc7d20e3855bf741ec18edd4a673235bfa2b9e1a8d668","app/handoffs.js":"9443be2e5efe3471c49c74634b32d88ea11e9066936f7c2a62732cb3f0efd15e","app/health-ui.js":"114b88330f76f0d8d2ef6dd949428129dd069a6801ae84e07fb4578437428177","app/health.js":"be166214c26a0e1af0aceb3b2250d1a23237d2dbc132201529682c0fd0eba405","app/holidays.js":"abf016950aad8ec6044f8b59e21bf1865acb6c6cbffd5bfe38e8101935d75592","app/ics.js":"7dbc44707f531580f05eef0e5351e924c09e6f14b8488bc855b8d619f33d7c8f","app/ilai-card.js":"4e8178e20867826b8c9cf7afa63801bda0d22eeece772645fedb11236d147a94","app/ilai-logic.js":"60e263b8c555cb8f65dce50ddcb241cef44868d8b11e2889475433962dc2c495","app/insights-page.js":"9c52418803ef79251819443aefd6ba21434c00c095777eba946a494444f3f570","app/insights.js":"8088d7cc5294ffff0c06114e85c9ee9bb7c677c99a98c0c7bd890e041b1b80d2","app/intake-data.js":"77da50026e126f8c0fc46e874b57ce516fb99c32b2ea976751cfaa4fe3edb3cf","app/intake-ui.js":"3f7f08ce0e902607e6588128faaab68ae21bba1a70bb47abb2745e16e147f4ee","app/intake.js":"1808df65d6a3b31c2b482a96d95ccbf1974a09320a054bb2344bbf0bee9e9c0c","app/kit.js":"4380db41d0c18e4a475120f033175d672f85967468a0d13408319b367ac00965","app/landing-control.js":"227370dd6ea4bc917bd46dc3316524553b9c92f15b9aae61c2a908c59ceb3d45","app/landing-data.js":"c2c58efe539a70f8ab64dce3be5787c418934f9c4a1af3d541a25c0bd30ff353","app/landing-logic.js":"ed7e4ad428b75b9e2e247b71d75ae9d59cb399abf1271486a46a6de46b7a1e2b","app/landing-ui.js":"1520e9f1d47bdcb761f28232f85efa2c0becaf452e1a6c6ca9f679e2d922e5d9","app/late-chain.js":"55cf8391176763f4f6d08730502e3bfa48793a0082959aefd60928b20cf122e9","app/legal.js":"07ab7703a28952c4b64d4116332279303a3b22991f68c999092629acdbf63be1","app/link-token.js":"4c7071749b1b38c57d7915fa3dc1f2f887080f74a9ffeb5f7b50076b5bf6aa62","app/login-gate.js":"a6ebfb294aad632130bf467d6a8818c653e156ddd185eebde6ec7041dffb730c","app/login-ui.js":"1ab6056f86e60227f5366514e3e0f8897eade0cf85df44361ed73edb77246c3c","app/manager-data.js":"85597fd7742480743c6e82fee52684968d53197b69821fa41ef8f2fcbf2c0147","app/manager-rules.js":"74ac10bdf573241f6ef9cb55ac7adb14b39fe446d5eee397ec9ef1fed551bd93","app/manager-table.js":"1474b707eeb4f7cfe61fd49560320362c6c22a945a1f5fc833e0f5aabe6a5654","app/mark-guards.js":"2211c4aa03bfc52643727a65390dd292d8d461042961bd34d077302bb5b97acf","app/messages-logic.js":"938f5949ecaaccd3c70c716913663fe7d32542887dd6dfb187b7c37ddcabeb46","app/messages.js":"c3f06009fabd3b5fe639fbe96624c21bb07592571e929e47150154210ef52819","app/metricool-connect-logic.js":"1bd1cf2688fa19bc9fa99f927afbb6c987c7fbe8038700e45def2b113441b455","app/metricool-connect-ui.js":"e2dbd62a0463d44c28089ebaf9117c8c594621cb44166206fe961fbcd1b12c2a","app/metricool-logic.js":"793cf13618240bee1d2d0189a228accc451e7635865c1f40148790d1c0166334","app/metricool-team.js":"976c84ccb7087ee84c61fae2fc146c075c0c525cd2957bcac83ca5252719f2e4","app/mine-flow-data.js":"5234d011748310cde633ffe14eb357c27a604b38458bb3239c52b031957e62d6","app/mine-flow.js":"7b529173c5bbd97d23e19f56c1a2635f18a6c13bbb9760a64a9673dbe1f0029a","app/month-ui.js":"4deae012bf3f72cb7e4f638a9bcaf78755a0a395e74a53005a527a10ebd1c954","app/now-bar.js":"b6d357e69e2245b330046352c2861ec8bda60991b75492f13f7530a08fdafa60","app/office-data.js":"42d4fcaee4d67953ad273422df5b0230df850bc3299edfb95a98c7c5f30ac30e","app/office-marks.js":"8520ae5df9e2a7c8126522d2b8431144c434ce635f1dcb0cd700ba39958df594","app/office-ui.js":"82972eed7bb336b32d015ae61c5188d0be6751267f182269cf7d5a5536c28a67","app/owner-data.js":"0348c0d304511a8ed3b2c2ab761e8fbf2ef81a079084f21b619409b2c1c60fa0","app/owner.js":"e5827cae593a46e0f0e3489c1d711eadaac066fe3c9c9035fe8313e7184f4b39","app/pass-logic.js":"c646e968a1d9736c58d9b65bb1909e92b8d0031b3fd35d25f6776489bb947712","app/pass.js":"3aa36f7bb2b805dcbb6f582498f7374c0746b144b322ac58da6f4d97b20a3979","app/payouts/app.js":"341da9f43584f376558222f6bfc276931efe2dc396b34fd135a22eccf58cb95c","app/payouts/client.js":"0931a4786e8a712694137ceb2b6031366818ae6d4efb64768b4217d355b20ed5","app/payouts/data.js":"0a7767abdd3eed3772571679b435ce4b827c451b66fa5e30c1ebc24343e7b6fd","app/payouts/engine.js":"ad944d1ca1732122913bc277feb77491f893f37a8634b5a98ae8752a4e4fa09f","app/prep.js":"e0d65d1836f0b29c9ac22bf9dc6ae8a280c2250beb9236be612b717ba0710835","app/pricing.js":"2b63a0beb2149899db2de51cac8309ceb5b0742b9d8abaf55ac102a4eb34fdc7","app/production-data.js":"1c09b35954f5575e07b913175aae9ce3a7dcc2ae807bfb7d1f4a78f3baad9209","app/production.js":"4cc098a3e66ff3937921285ce54ee2a99b2dcbd69196e9d81854a810451a3fa2","app/protocol-data.js":"4e512af6dada9699ecdb1a524f34144beb855e6dbcdc0ab80178d5c58c570945","app/protocol-logic.js":"31e3c3ad4ebcb89316b644af83f6662fa60e106bd20cb8172cbe4fd80a80173d","app/protocol-ui.js":"b4f26d178c7f0d184634a7c875b61fce466c512f421e68c01d81096a728e3d99","app/protocol-versions.js":"2860b24d4140b51372f447e37714275e851a045d470b5f0c6f1d6f2c83719f0f","app/protocol.js":"7a6ed493a9dc67f645f6108d52c841f38dfb4119b1ca60f5ac06e7a41ad59e6b","app/push-config.js":"b8fbb7f69ec84dea60a1bcdb43a59dfa69ce61e389b61c600214b53ae78f4d55","app/push-logic.js":"effbc67ff72b439f5280ea251f9ee106be99ec4f7b7b60f548c0f956ba330303","app/push.js":"6e6938ae126bb39c3506940138c2a5d43d47526af8e50b88df6b568341270d9f","app/qa-logic.js":"1aba155684da07e9c8b4450c45b46e8406db4eba97556aff87cadaad2963b706","app/qa.js":"9cd84953fe06ac2ec980a4eccf9537230a3726cd6aa9f52214d6ddf423205c94","app/questions-ui.js":"2b72df41eb8da6a91250932eebc7a7afdaba480d2952a12f6be5240f15842be6","app/quote-doc.js":"5fc86fc5a5bd6aa5fcfeaf9ad83551759eecb93669fbddc4abe4b4a725811e6f","app/reminder-engine.js":"9d7a3dae3c60ac5cf9a9df319be77c01a39327a738569b54e21a65fc20d5c07a","app/reminder-rules.js":"8f85fc314cb457f260dbedd3c028e439534fcadbdc4223f79f7875ad4614fae9","app/renewals.js":"3172f3da40d75b90bdde10bce80de32ed99e7d9c063147642f58a47dc5366ef0","app/scripts-data.js":"3f1ee05eb7eb630f0371273b581064c4470b01b70816b5d037b4b2ffceeecab8","app/scripts-logic.js":"244b81636adedf277e355aa8c7ffe45d74c2214e0f231e21303fd0b2a05ae7fe","app/scripts-view.js":"71fc4e1f78ed92fa290ab16f1b2fdfcd55ac68897b31344a26e7a46273db8052","app/scripts.js":"8687ec53b52f1a189a46bd9e88f731ee28290d2ab198d1c2607ba8603be37e61","app/set-password.js":"6c8ec25c4dd1ce3acf67984e175f2b2e18a16de1f9164adf85513a78317a0747","app/shell-rules.js":"ff755ff98634370532fb8290d5de81285447986114f95b329dfb54d426e87e52","app/shell.js":"24c08b6c7df635f4f6ed3c0209a8ebb13158d961e33b928b51c86ec80539694b","app/shoot-prep.js":"a7e312ae877385f75dc81a7b1a10c64f5d209b089258ee44b337bedf2fa34911","app/shoot-table.js":"12f545104d622d5ded896d874ee1197103ff9c01de2090662f45d43dcd95e2c5","app/shoot.js":"105dc580188669e152ceff75444eba3c70f3bd0870a63a7028c076dd2fb9a29a","app/staff-tasks-logic.js":"a4e9831108d037eeeb7cb48499d59768426fb93a8c0b079dac4820a511f0c3e3","app/staff-tasks-ui.js":"bd28b2c345c20d805602113ba28a2da3b06fdc28ce2231b80112ec79f01bb18e","app/status-link-ui.js":"1eccb39ce64708ece8a2919e6ea242f19fe75bdb13beb3098be51f75aa73871e","app/status-logic.js":"4c0280003799d031780d18e1c485f9e6eb6e45cf7e1903b4916daf7f2a14ccc0","app/status-rules.js":"624e01a15644344d6a0514bcd1e9eaef572cc291bad229ad13b59fbf7863bc49","app/status.js":"2f279845c0316b59416bc3baa544a6d61af1036958868b91ed69c3777e9b0023","app/styles/access.css":"250823ea6b359f083995b298fac9091bff653cacf82e3aa801ab88e2647c987b","app/styles/app.css":"941ffdf9558ac4f5df29a9dabdb9ff6f77b089df0160eda6ca8f5c0884c1522c","app/styles/approvals.css":"d046530389c8b393e754112213377edf9238809ff5c0daaf763983a65eea9d40","app/styles/availability.css":"b9ee5bdc922ff1c022762c1f7a6015476e30bbef56c13a84d2ebb6499180bc33","app/styles/calendar.css":"35b5240dfffb5d17b57aba3ea31368ec1dbeef97908782c3d75884cb14c68e93","app/styles/client.css":"92facb2e4f759348bafcd14ec7d8f9df17058b29927c36e89dcb40222473e5f2","app/styles/deal.css":"afcec6a92c429134a703b38eb9d9afd3759275cc3f2095a3effc1ee1d1f36723","app/styles/files.css":"65c982dbf660a4e04b09f376b2a6ad8ac517dea77f8df5f968cbd8cc20e63141","app/styles/gallery.css":"61a391677ff745173161e81940431c2512d86c0882ac400e4664fb2657ab9144","app/styles/gantt.css":"ae26ddcb22694984da15e402fe4a3fa9806245e45c699a4f554507622b3c7766","app/styles/insights.css":"943a085b75d7b569087f252caa5b94d95221fcf8f8839a9d4dc5040ba8d45da7","app/styles/intake.css":"2c3d059a2f72a4cba36dc709811d2078c7b25283179fe824848036a1645f3859","app/styles/kit.css":"8d2a5d20618710ed1bea1e8b746f39307c23ea2cf37fa36bd5755f00c3b5ef89","app/styles/landing.css":"9541f0bd3d73eeb652a6068cc3d44475461d3213da2de13a7f706284dba6236c","app/styles/login.css":"045c9399e3dddb8d848e31e37a2a59c3fc36578e157cd1284b516ac4460c91f5","app/styles/manager.css":"88b7f097e15331ad408679a9a52065e0f7f0754b130101807ccad325a0e2c400","app/styles/messages.css":"6ccfe7b195f45dbc39573a0fd44983122b42ea4a39f2becf54a86e0024f0f8df","app/styles/metricool-connect.css":"1ae0a0861a263a2ea636c6a522108a27d0ec1ccb06c57e1b0ec4b10724a31563","app/styles/office-flows.css":"4522cfb7ff2051c3af7090bd2a3327152c0b2713f4ea7f5ac7778524251d036e","app/styles/owner.css":"2f116e104d085caf07786a5855b38f58461308b23a60a59ef8837228d078de0c","app/styles/payouts.css":"f6e5a5d1d8ec4ea94632d965451fda2da978a6e9060652ee9f8fc607817f5358","app/styles/production.css":"18e704089ad83b83ee01bc448cc38c95bc35f48b21075f7e310c35c3a8fbc362","app/styles/protocol-now.css":"41c08e450bc358ce9b5f56eca4967e409a562a42bb0f9673eb58698aaa576ca3","app/styles/protocol-office.css":"ced13afcecbb01286e89e48b5af692520a691df7ad3fdb06d46cf9f4c4d07ec8","app/styles/protocol-roles.css":"e147ec1fb63f2a5cc0488b16ecdfaecb1c63908d2d858b6fce373223d236a317","app/styles/protocol.css":"e4c203a50f7b10c84c86c7fde1461f33bbbbb8855d53c733c243d6c9f69e2e97","app/styles/push.css":"591688264e39f072d350a185227a600a7cdb9ab97e68078aa13d63123798e670","app/styles/quote.css":"4d5b1baea5a7fa00286ecdc8b21ec0d8aae8d973dc384fdaa687a4f15694da47","app/styles/quotes.css":"a45a31ac44d74baaba243d464f891f92e97bfc4229d418f5efe79a62870f0e75","app/styles/scripts-view.css":"4091e0f6508fac5b8d389283245a7d314bc6cf96f9d976f364fbe121030a976e","app/styles/scripts.css":"472a84c281f143a5010f0ee2260bf16c9a6ff188b8d0deb03457ffc244d03763","app/styles/shell.css":"bd3ec3a5bad0b88c69dbf3535bd41d6173ae05df0f45e215c2edcf7874189d95","app/styles/staff-tasks.css":"8312b030b8d38a3993ada01707a48340916e216d0409775fc22cdce69c09d487","app/styles/status-card.css":"3d2f386b2f7e885afd8e1dccf64c7faa944eb4abe7699226ca2c24cff6fbe782","app/styles/status.css":"9f6e6bff9ff61cef52c72b912125d964122b7d7933714908c1a70f3765c0939a","app/styles/team.css":"5c4404a699c09f4b2c5858884e71997c3b59df898b1c828e51349fc7c3371805","app/styles/tokens.css":"aed87f86b6d9b3d5df647429db28eba13a87c968baa11e7ec3781c0ef2879e4d","app/styles/whatsapp.css":"043d77cee016735843592a04cec50b16d8bac6fd8fc61f99f7539fd216032a5b","app/styles/year.css":"c4f06f9a389524304ec22e5664d573e1fb417a849f7708912ebb64377a2e5f20","app/supa.js":"ffb1956a41ab8aca355f1f65465673c054881b432a7e2b7f0fe8bda1347a41ef","app/surveys.js":"a4d4f9cd4e2479084c2f8f7ca24722eed3cf3f5372a0fcc9b8b7b5cd5ddd143a","app/team-rules.js":"87fbfad386801f29960a2a68d3be2fd165c29ff38f353657dbb77a281d010a05","app/team.js":"417c2cd9421e93e36d7b5f0751c44e5abe698704452fbd06529e8b073ac2b68c","app/tz.js":"ee0f143edf0a63b7ea240f3e83e53bbda2db1501a4e992dee63788fd0ec7fd32","app/unsigned-logic.js":"3f26e386c394fb81d9eae0763e65f1b57056424a7d239f57037d47d4d95514fa","app/upload.js":"5e851d69cc1f253be0c2533ded69efa517add9ef0323bbae9b47b677a4ea6c77","app/vault-code-team.js":"8e86d0950a13a4de6b893a6d47a8ba083a69c3c8a0500978bcd43a2f5c51a683","app/vault-code.js":"185a9610edde21c5402949f1ca3a9adc3b93495f7673dec38e7ad3cbfe9ca30a","app/vault-gate.js":"d7bd533353ac0d03875d4ba7967a5282935ad6e2df6b27372fd207a46a628f03","app/vendor/supabase.js":"649e46c496fae692ad4fc75ee1a9da5315f79029267cd4df847e7de192cacf77","app/wa-logic.js":"03735685c30cd2b428fd4b74b4f9253891dc8f500f2c9622336ef8efaa921b4f","app/wa-team.js":"114bce61e9899d4f373532d3c8ca2d852beafe2cee0864e6876d52f2f9aab19d","app/wa-templates.js":"18ee85d5efaf5e3ca5ad0ab58a94edfdbc3312ecd9f30990b7f903da97ac65d5","app/week-chart.js":"2399112320f3aa5c48a2a45ceb2d9de8c1e0ffa3163f7d75103b44d3b528cd36","app/whatsapp.js":"c6cae6fc1ed6a6372689daa49cb90fbda6fa94527ccb0769950569cfdab62f78","app/year-data.js":"a8c652ced94694b9794c3c71e27de06853e2422eb5d4dbef80249c0171125c74","app/year-logic.js":"4c2d7c7e32897837391d6a499eea264fbb8762e5aa0eb5e9697137d7c35313f4","app/year-rules.js":"bbf8341a77e81122aa2f7b5aac516b5527d3e6aab66e784608fb3a5829f4d382","app/year.js":"364a59edfcc1adcbd7937036273eb0d5743ce6764274fdbeffd5ace4a0b765c3","client.html":"3a078af8f6229085f4a7652db0ca4e0f7c2e324b2cbafbfbbdffdf28ead67fa2","clients.html":"7f8143813c1865b603613e9d80795c51e10b67fee0d22331fe08876b2f280981","clients.webmanifest":"dffd9dbdf193e2f83b7b7f9204b4ddc44355bf78148be05f3e03e3566db4bbca","deal.html":"2b364c129eb3ffabb5461a5a00b2a35d43eb16d6ef0a2a673a80e168b62dfa8d","decisions.html":"0c48093803b699874533e862ab6815b956a067453c1085ae62a2a9c1968cb7bf","editor.html":"f3d1a5029d7e043abb637ce6a75f9590cc3d622c1ea844ee63598b0171bfb027","gallery.html":"bb1f481f6c49358e357c33ad2b275e647624d8aaa58477071a051816c7b6e4ba","gantt.html":"8acd00a3f3f4a2c6844511d5cf2e9f7f78f918d9c2e43e7c2b7dc4b4ee63ab3e","index.html":"e319abeac8248dd96c05636dbd9223eff5ba0f5209440c7cd07709052b2984d4","insights.html":"de10ab59a6ebd4546e6051195d5be90d4f4d9ea911760595186c6e01dc9243ef","intake.html":"97e0f04c4b1d9b879194b41e0322a9d4fcab666ec07799a16fd4b29a106d7815","landing.html":"9c0493f1a68a91889f10ed107d7609a9964b8130013555255619874e33f72e80","messages.html":"3959a8e4bf4bdc35675ad882e08a28722f1e5e15814eccd92391638a106e46b1","owner.html":"e5fdf9c983c0e4d34482d63f1e12a2efd02309e5f0a29886601fd0648f02b73a","pass.html":"46a59e425e667e9f55f4d75ed065b58a39c1c0173e596b84e5c737885446705b","payouts/icons/apple-touch-icon.png":"92be9723bfd93667664b9b95faad98814797f4234abfc18019ee86913a379b4a","payouts/icons/icon-192.png":"5a91a352273691a55273d1a4c18461de1d259b63c409e711348fefe59d1378b8","payouts/icons/icon-512.png":"56a1b7ae11292a27300ff62fcf5882d4b617f756176bf1d42423275386c3dd8d","payouts/icons/icon-maskable-512.png":"63e86d4264628005c7cbd01c7af0f5e61dcc76a1a3822f37a5785d3a9a2ceb8f","payouts/index.html":"fd08a1027e31e98082bee70c9a6f743842555e566aec79afe27cb2ba0122607c","payouts/manifest.webmanifest":"94f87d9f9a4f8d93f7e20d21e0dfcfaa81513db9271dd5984fe146c082516ac5","prep.html":"f792a991c5e2fa9ca0ad60494bb3d910c32280b90d26a241b6349fba04918b18","q.html":"a7e8af3c72565e4246c6f5901edef79de861bfe0d621baf291527be0ad0718c6","qa.html":"5f5c5107961317a6d591752554131d8b68889d0a7f78637b551844aff5e0a15b","quotes.html":"43d9ddba38689303ab3f3dec62ab81f364285775a06aa983b46912716099581e","scripts-view.html":"5edf77c5df6ac42a04335cb6f2a5a857287bf25e11dad713adf90faa78854485","scripts.html":"6b2cc643dbe91078b972e5eb621a7e6e742a109f520025d7e542710c43544bb7","shoot.html":"d5a740f050407a62e04cea6c5dc243295f7df521d79e1b926ec7df52966a42bc","staff-privacy.html":"b49d64da4c7c64bc4e15a1e8f7492a34faf02fb40ff95af2d6442aa8b67e82b6","status.html":"6756f8f5364962d80f891afe8ca24a5e7a1ea120a9226cc6e9c8a7854c0d8091","team.html":"f382927f7ab908c19c5ccd309d8127252b3d9df0c244d674e10b00786742f481","year.html":"c230c81fa8777527cb9489ef2520a9b44e187e0f8269dbbe8fe244fc7865770d"}};
// One store per published version. A version is used only once it is whole (every
// file fetched and its content checked against the list), so a page never runs
// scripts of two versions; until then the last whole version answers, or the network.
const STORE = 'astrateg-site-';
const WHOLE = '__whole__';
const own = BUILD ? `${STORE}${BUILD.version}` : null;
const at = (path) => new URL(path, self.registration.scope).href;
// The file a same-site address stands for ('' and 'payouts/' are their index.html).
function fileOf(url) {
  const base = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(base)) return null;
  let path = url.pathname.slice(base.length);
  try { path = decodeURIComponent(path); } catch { return null; }
  if (path === '' || path.endsWith('/')) path += 'index.html';
  return path;
}
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function listOf(name) {
  try {
    const hit = await (await caches.open(name)).match(at(WHOLE));
    return hit ? await hit.json() : null;
  } catch { return null; }
}
// The version that answers now: this one when it is whole, else the newest whole one before it.
let answering = null;
let before; // looked up once: the older stores do not change until this one is whole
async function wholeStore() {
  if (answering) return answering;
  if (await listOf(own)) { answering = own; return own; }
  before ??= (async () => {
    const names = (await caches.keys()).filter((n) => n.startsWith(STORE) && n !== own).reverse();
    for (const n of names) if (await listOf(n)) return n;
    return null;
  })();
  return before;
}
// A page keeps the version it opened with. Kept in memory: a new worker starts by giving
// every page that is already open the version that answered until now (fill), and after
// a plain restart of the same worker a page takes the version that answers now.
const pinned = new Map();

// Fetches what this version is missing: a file an older version already holds with the
// same content is copied, the rest come from the network past every cache
// and are checked. Any failure leaves the store unfinished; the next page tries again.
let filling = null;
function fillStore() {
  filling ||= fill().catch(() => false).finally(() => { filling = null; });
  return filling;
}
async function fill() {
  if (await listOf(own)) return true;
  // The pages that are open now were opened before this version was whole.
  const until = await wholeStore();
  if (until && until !== own) {
    for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) if (!pinned.has(c.id)) pinned.set(c.id, until);
  }
  const cache = await caches.open(own);
  const olds = [];
  for (const n of (await caches.keys()).filter((x) => x.startsWith(STORE) && x !== own)) {
    const files = await listOf(n);
    if (files) olds.push([await caches.open(n), files]);
  }
  const take = async (path) => {
    const want = BUILD.files[path];
    if (await cache.match(at(path))) return;
    for (const [old, files] of olds) {
      if (files[path] !== want) continue;
      const kept = await old.match(at(path));
      if (kept) { await cache.put(at(path), kept); return; }
    }
    const res = await fetch(`${at(path)}?v=${want.slice(0, 16)}`, { cache: 'no-store', credentials: 'omit', redirect: 'error' });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    const body = await res.arrayBuffer();
    if (hex(await crypto.subtle.digest('SHA-256', body)) !== want) throw new Error(`${path}: not the published content`);
    await cache.put(at(path), new Response(body, { status: 200, headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream' } }));
  };
  const paths = Object.keys(BUILD.files);
  let next = 0;
  const lane = async () => { while (next < paths.length) await take(paths[next++]); };
  await Promise.all(Array.from({ length: 6 }, lane));
  await cache.put(at(WHOLE), new Response(JSON.stringify(BUILD.files), { headers: { 'content-type': 'application/json' } }));
  answering = own;
  // Older versions go, except one a page that is still open runs on. That page is told,
  // so it can load itself again when that disturbs nobody (app/feel.js).
  const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const ids = new Set(open.map((c) => c.id));
  for (const id of [...pinned.keys()]) if (!ids.has(id)) pinned.delete(id);
  const keep = new Set([own, ...pinned.values()]);
  for (const n of await caches.keys()) if (n.startsWith(STORE) && !keep.has(n)) await caches.delete(n);
  for (const c of open) if (pinned.has(c.id) && pinned.get(c.id) !== own) c.postMessage({ type: 'astrateg-update', version: BUILD.version });
  return true;
}

async function answer(event, path) {
  const nav = event.request.mode === 'navigate';
  let name = nav ? null : pinned.get(event.clientId);
  if (!name) {
    name = await wholeStore();
    const id = nav ? event.resultingClientId : event.clientId;
    if (name && id) pinned.set(id, name);
  }
  if (name) {
    const hit = await (await caches.open(name)).match(at(path));
    if (hit) return hit;
  }
  return fetch(event.request);
}

// A worker that keeps nothing (the repository, or a publish made with --no-store) clears what an earlier one kept.
if (!BUILD) {
  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => { for (const n of await caches.keys()) if (n.startsWith(STORE)) await caches.delete(n); })().catch(() => {}));
  });
}
if (BUILD) {
  // A newer publish: its files are fetched at once (the pages are answered from the older
  // store meanwhile). The very first store waits for the page to ask, once it is shown,
  // so it does not take the network from a page that is still loading.
  self.addEventListener('activate', () => { wholeStore().then((name) => { if (name) fillStore(); }).catch(() => {}); });
  // A page that opened asks for the store to be completed (app/feel.js).
  self.addEventListener('message', (event) => { if (event.data?.type === 'astrateg-fill') event.waitUntil(fillStore()); });
  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || req.headers.has('range')) return;
    const url = new URL(req.url);
    // Another host (the database, the functions, the client's files): never touched, never stored.
    if (url.origin !== self.location.origin) return;
    const path = fileOf(url);
    if (!path || !Object.prototype.hasOwnProperty.call(BUILD.files, path)) return;
    if (req.mode === 'navigate' && answering !== own) event.waitUntil(fillStore());
    event.respondWith(answer(event, path));
  });
}

// A link inside the site, or the "my work" page.
function inSite(href) {
  try {
    const u = new URL(href || HOME, self.registration.scope);
    if (u.origin === self.location.origin) return u.href;
  } catch { /* not a URL */ }
  return new URL(HOME, self.registration.scope).href;
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const title = String(data.title || 'אסטרטג').slice(0, 200);
  event.waitUntil(self.registration.showNotification(title, {
    body: String(data.body || '').slice(0, 1000),
    tag: data.tag ? String(data.tag).slice(0, 200) : undefined,
    renotify: !!(data.tag && data.renotify),
    data: { href: inSite(data.url) },
    dir: 'rtl',
    lang: 'he',
    icon: new URL('payouts/icons/icon-192.png', self.registration.scope).href,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let href = null;
  try { href = new URL(event.notification.data?.href); } catch { return; }
  if (href.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.find((w) => w.url === href.href);
    if (open) return open.focus();
    return self.clients.openWindow(href.href);
  })());
});
