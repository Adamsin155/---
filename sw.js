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
const BUILD = {"version":"afbaff03bba7c302","files":{"access.html":"925bade00174f5809b79c1bcbb874be2bc0eda5b3911c25b38fa4ffa20e89444","app/access-data.js":"3fe9ecf8bd36c04e71fe33b949649fb5f97966c68c6bdc0a13da7ecf553813cc","app/access-form.js":"c603b76260710129758f4ef1f9433ae087f4ac0d3b4d8f4f172288bb5cea5488","app/access-link-ui.js":"8710222a349bfed486b9cd675f7588ae0fd9653e61318e48d5d8121efdf2cf85","app/access-logic.js":"91c92936be8aebc4cf5ace29a67b2facaa11b5ba3809f2149ea3eab10ea54c7f","app/access-nudge.js":"1591ad693817b357068ce891bcead9fa043175c2f95868487b1b0a584d4b3f1a","app/approvals-logic.js":"9a79515750c19c85557482995ff00baafa1f8f4def50ba7912f0f225d17ecdc9","app/approvals-ui.js":"7a6e66cc8b99b22f65f02cc5277fff19b8e1559f1d953375d023caa4a109e50b","app/assets/logo-mark.png":"2cd2f349d456cb9b3ec6296cd9f069f1ffe65d1bcacceff8c878067d812954a4","app/assets/logo.png":"f3449f67c8e000b64f4b70e4e1f4d416b3461f5bac4b3c8bc4bfd281cff826c3","app/auto-assign.js":"4f81af99bd039c217a7a348022fdb045595deeeb3321dc8b2c41625e17340ee1","app/availability-logic.js":"1923d38721d0fb5ecb61c560b536a47eb8948ed3bc75435fddbc1404a0dc2f91","app/availability-ui.js":"5baaa695aab006f9cbe78fb6ed1018c94d56e3fa60ad3fe650098932c7cb1827","app/briefs.js":"84d702fcfa7640ef1152dba3009a3720e0bc89c888ef5f9d30648b6803a44c88","app/builder.js":"df562dd1c332614c08d51b992936185af0822f7bedfd4c14861640267ac469ad","app/calendar-card.js":"bc437675a5b386f2c528580ba5afb19a1067022e60f89cb4b26b3b9717674a55","app/calendar-feed.js":"3b89d9cc0b8ed954e796729d610caa348f6218652c3b5769c44b994f24c18945","app/calendar.js":"d3e9d34c2379728bbdc62d1428db263f97a1c22cb549929d9948c53a2a0e2e28","app/catalog.js":"f3f84fab12be0e9bd272798205918b1bf7d29815cc3de7c679249538e5edf5c1","app/characterization.js":"db72366dbe696d19c75e604cfd62551a50b9cbef68ad04daa3cacb28ba0726d2","app/client-card.js":"cb27e97cdc79a49d6a87e1e329c1ff1fda7c8d6939e013ad42894e2a1efdd01e","app/client-links.js":"3b0b9d9f37fcde761e125f8789ae5a685da13e477b16863528f59481608ae035","app/client-open.js":"6303eecfb0153ec430dbbaf88cd60d3b56448db4086c33d7d3420c4cfa52ff40","app/client-waits.js":"26e40be97dd7fae399b3d4457f05da772f1ec42ccacd966ddbb8bdba0c91ebf7","app/client.js":"4a46735b73393cfa00a93cd83546068b94ad444019c97bd650a49ac2d5644cc1","app/clients.js":"0d94a50999de46e436b5d052ad1833ec47f06ed7c0a1f22f86bbe80416ea5e1e","app/clocks.js":"015f79f6d3e8e1b69548b4875419c172e8b74e0af19a6b8d9223c46710ba11df","app/contract-end-ui.js":"d98df7952bae2974b3f93d4e8558699533a66bef04c6319f06c7b9210a3ebc37","app/contract-end.js":"b66cecd558d1d652468a99a3c95a2845e02fca302ff636921fea1bac165ac10b","app/contract-summary.js":"3c60c582f369edc1b75c5e4f555eb1d669d1187ca968786d914e0b29bea0327f","app/control-topics.js":"c5002eda2c1cf7aa26b896e8c3ff807da1f138df7ab2c4d8cdd914e0e2bc0e78","app/dashboard.js":"6a27f7e7eaf39eb65d0f9ec630585a0725cf1a39bb2109fe0813f32d81488197","app/data-cache.js":"c7445ec7cf40620df76970c217259f2069d9421cf4cbaf9c9d05128441a8dffe","app/day-summary.js":"0d24e7ee320e4ae6fc6025b56e45aec48ffec3ec304740d8ab5247a4311abb53","app/deal-data.js":"5f073e8cb070eb5eee1a8181c59e8472778ec6389002dddb5a89a0d9a22534bf","app/deal-logic.js":"e3de454adc1d7fb2770ae695779b1ef7337d21020fa8bf12daa6265526306573","app/deal-ui.js":"2eb541a8531c558bb9ad44ecacd4c9161a52b887bf86f862117c378897b866ec","app/deal.js":"c2c4e8cd3462a6231690c38bd33e45b850c11bcde01c4a721c23e5041efd4809","app/decisions-logic.js":"b16b2579bd5edcb6be142697e33329e8857ccaecc79fc5b440e7cfb948d8c157","app/decisions.js":"3470ea161ac4c166e42a5c1bc5a9b1c6f6aec7f686042186afb9b8afa729ec4a","app/editor.js":"a85ddba66574e19f19c97303e089c038645a41c2876fe01765011a67409506d5","app/fast-ladder.js":"e0513fdf9538222d012ad57cc0c8dc7587c8dcaa678937e7f5a7f0f45eba07d8","app/feel.js":"59e125c5ec2091ad8745c03d9483be37d259eaf865a897218b02da546c9534da","app/files-logic.js":"4b9f26671f9ce3f930efad3d628331158c810327c5b24f96628d8f85478c1e10","app/files-ui.js":"1ae6425a4f84acdb8ba3bfa003b5a852ffd5fe5e8a7b1882f3a1473a9b8cef17","app/fix-request-ui.js":"237abeb2bfe053807e3ba66285184dcc667792c67961fa1c8f2de78a329a090c","app/fix-request.js":"f949d7353fb9b739491334a8390da73431437fdd607cf10be48570437ac3a970","app/fonts/OFL.txt":"5163e9f9fda30f27c95700c375293baaf841afc890d8a8496113bc954a19ab7f","app/fonts/fonts.css":"84aa1405bf6ad2b9254f23e2afbe389d852308c8c4d8305fa97e9be4d28e2236","app/fonts/heebo-hebrew.woff2":"f1f7cfaef59431c7b391df81fb05520273303840bbe917213a2ab9f41b839675","app/fonts/heebo-latin.woff2":"50dae2e12dae22c920388023e35aaebcd1e1d27bbe915c83d64210377e083e60","app/fonts/jetbrains-mono-latin.woff2":"18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e","app/fonts/rubik-hebrew.woff2":"197b6dbe5c6bec7276c59b02d70a16ee6acd44322fc2f8d0226c07f8d57976c2","app/fonts/rubik-latin.woff2":"691cd1d9b4c0cdf31a1dcf04259c86f92c85e69f6622abab7964d81e36890691","app/fonts/varela-round-hebrew.woff2":"61f49780c3763145a924f538636d2e4aa190d614ea44a190758260896e4d804d","app/fonts/varela-round-latin.woff2":"03871f86c86fc776f89d0cb947502f3957181b63327fecaec724bc39d082319f","app/frame-guard.js":"b6e68dfdeab0aefbd99ae86d6138a4a99fc3e23eefba5cffd373732718a063c9","app/gallery.js":"a1f6ac4cc72ac8abc5a5aa51c7b7e91410a62fee337c535219c200ef98111476","app/gantt-brand.js":"18e775406d5f5421197e8d5f805cfedc220ffe2f1f1279aa6614410ef3dae08f","app/gantt-data.js":"fb0dcd59119161c4cd8addb42637ddf573378a999b18305326bdebdc96a679da","app/gantt-index.js":"fb6f5473873eeafa598f6fcdabeb5984f0709a15a66dbd3eac73a5d96d1fd28b","app/gantt-logic.js":"f535886eaa9cf1ff1e3b5a1d66e0e5b7a69284c1cb65e2e7fc4fef6d72021cae","app/gantt-template.js":"d64560bce00d1a4de816b99f839f07d6e7c9108ea77218ff5240a41a51d1eeed","app/gantt.js":"99dc89051332f6e6230258ebe3dfae507e574be838d329656b7a1fb6c6949272","app/handoff-ui.js":"3cd85b5165b7db50ce8e3a2a751d4894085ace53923adc0a8fe12b3895982aec","app/handoffs.js":"a3784f5a72117e4347b6d7f9eba9ed6e5fff12cc5d63ba58eadfc038a5eb6bd7","app/health-ui.js":"114b88330f76f0d8d2ef6dd949428129dd069a6801ae84e07fb4578437428177","app/health.js":"f7d725c88f09a47748f64e814adc88f7267c52577952486e3e10ac46deb169f0","app/holidays.js":"abf016950aad8ec6044f8b59e21bf1865acb6c6cbffd5bfe38e8101935d75592","app/ics.js":"7dbc44707f531580f05eef0e5351e924c09e6f14b8488bc855b8d619f33d7c8f","app/ilai-card.js":"5a8f140f89d8a09297a6dfe08a39b969a05451b808411e7315ea8db35392a081","app/ilai-logic.js":"b7e5e4137a7cf16476b8c27599200029ffb40907391169a3cbc29b1a74883f6e","app/insights-page.js":"8fa1d6aca289e9011bbeaf6e43e283b57da8b92757a7a88512fdef0d2209dbfd","app/insights.js":"51a834097394adf5f21c7aea0a45a9d977d1bdbd9596795e8be41a9faee65eec","app/intake-data.js":"77da50026e126f8c0fc46e874b57ce516fb99c32b2ea976751cfaa4fe3edb3cf","app/intake-ui.js":"9b33cd68f4a80fd38ae80c5a71cf23012a99d7e3c74332c9ca09ff1a85389989","app/intake.js":"1808df65d6a3b31c2b482a96d95ccbf1974a09320a054bb2344bbf0bee9e9c0c","app/kit.js":"4380db41d0c18e4a475120f033175d672f85967468a0d13408319b367ac00965","app/landing-control.js":"227370dd6ea4bc917bd46dc3316524553b9c92f15b9aae61c2a908c59ceb3d45","app/landing-data.js":"c2c58efe539a70f8ab64dce3be5787c418934f9c4a1af3d541a25c0bd30ff353","app/landing-logic.js":"ed7e4ad428b75b9e2e247b71d75ae9d59cb399abf1271486a46a6de46b7a1e2b","app/landing-ui.js":"1364ffbfccee00241b94ac0e4f1bcc3496077f6e4a349d21f1a236d4631f8a7a","app/late-chain.js":"19c8e589b4ffeff7cbc10554081a62d2c96a9a9402d800a795dcc4a1b301dfac","app/legal.js":"07ab7703a28952c4b64d4116332279303a3b22991f68c999092629acdbf63be1","app/link-token.js":"4c7071749b1b38c57d7915fa3dc1f2f887080f74a9ffeb5f7b50076b5bf6aa62","app/login-gate.js":"a6ebfb294aad632130bf467d6a8818c653e156ddd185eebde6ec7041dffb730c","app/login-ui.js":"b8f309f41bd2bf79907903ac152e281ce93cfc340fe9d1f70ec3a2e2ef0916a3","app/manager-data.js":"85597fd7742480743c6e82fee52684968d53197b69821fa41ef8f2fcbf2c0147","app/manager-rules.js":"bf1642c30cdeeaeb6a339a8517c493fdcc1f686f8005e44f2799947332e4a93d","app/manager-table.js":"1474b707eeb4f7cfe61fd49560320362c6c22a945a1f5fc833e0f5aabe6a5654","app/mark-guards.js":"c9947482fd192a9623487e2c95686a141df282d893efd1d40fbbc377e17e1236","app/messages-logic.js":"938f5949ecaaccd3c70c716913663fe7d32542887dd6dfb187b7c37ddcabeb46","app/messages.js":"ed5962c6674e8c2c50105f3fb5ffb59d77cafac884dbb1671ee77621977b7a83","app/metricool-connect-logic.js":"1bd1cf2688fa19bc9fa99f927afbb6c987c7fbe8038700e45def2b113441b455","app/metricool-connect-ui.js":"e2dbd62a0463d44c28089ebaf9117c8c594621cb44166206fe961fbcd1b12c2a","app/metricool-logic.js":"793cf13618240bee1d2d0189a228accc451e7635865c1f40148790d1c0166334","app/metricool-team.js":"976c84ccb7087ee84c61fae2fc146c075c0c525cd2957bcac83ca5252719f2e4","app/mine-flow-data.js":"5234d011748310cde633ffe14eb357c27a604b38458bb3239c52b031957e62d6","app/mine-flow.js":"fabc78595b433005d49f25d1553a21185d89d0da745b077f54daf179ab8082fd","app/month-ui.js":"4deae012bf3f72cb7e4f638a9bcaf78755a0a395e74a53005a527a10ebd1c954","app/now-bar.js":"f6efa99df522793dadfe41f28ac660cc8295c130787da13e082dbec4d60322a8","app/office-data.js":"42d4fcaee4d67953ad273422df5b0230df850bc3299edfb95a98c7c5f30ac30e","app/office-marks.js":"49a7c2d984cb286dcedaa1f2e2617d541d75ba5d060103823435c77acd21d9f4","app/office-ui.js":"4aa7ca5e4ad09c0c1d74873792a28c15b072e3d940025ec87e24a57844a1cd31","app/owner-data.js":"0348c0d304511a8ed3b2c2ab761e8fbf2ef81a079084f21b619409b2c1c60fa0","app/owner.js":"0d2fe3b6bf90d1d555a4a76035d289e137581622ce01e1f62e9392dd663453a3","app/pass-logic.js":"c646e968a1d9736c58d9b65bb1909e92b8d0031b3fd35d25f6776489bb947712","app/pass.js":"c9d59b279c8ebf0d8ad5106acf870fb0614bc05e33c924761c3d3cbbaf3f2e59","app/payouts/app.js":"6d4e2f3dd8538d52f75a5954528563610e3f918c583d0d6c1f9e3a3edd0c2fbb","app/payouts/client.js":"0931a4786e8a712694137ceb2b6031366818ae6d4efb64768b4217d355b20ed5","app/payouts/data.js":"0a7767abdd3eed3772571679b435ce4b827c451b66fa5e30c1ebc24343e7b6fd","app/payouts/door.js":"532ea19714e99897c7eb57fcd1a181932e05d89496f482cf6be0c846ca8ec03e","app/payouts/engine.js":"ad944d1ca1732122913bc277feb77491f893f37a8634b5a98ae8752a4e4fa09f","app/payouts/gate.js":"5409be7ed9a7d3d6147066a0ef0ae3a12dc7a91831207830f79be140ea53d5de","app/prep.js":"ac8f8bcf42f360dda36a936e54665f61905e007c504ca161d941f2d64b32997e","app/pricing.js":"2b63a0beb2149899db2de51cac8309ceb5b0742b9d8abaf55ac102a4eb34fdc7","app/production-data.js":"1c09b35954f5575e07b913175aae9ce3a7dcc2ae807bfb7d1f4a78f3baad9209","app/production.js":"ad70f025866215f797531b77ba8dfbb0938e77b5a44e4f59283f05aa7bb18f1f","app/protocol-data.js":"3aeb577080b06b766752516080d3e458607b2832a9dffb2463ba8a89f967d467","app/protocol-logic.js":"241e9a165782f7252e5905986a36b421011456d6f16baebed80cd687ffcd8085","app/protocol-ui.js":"5a9423da1ed5d37f6a0fdf10b3cd4a75c8f6fb6bee3465fe17f3dd25f580c6ad","app/protocol-versions.js":"31b87e0148937e68c74cc4509a34a816f9cb94245f0062edd486b3133c688946","app/protocol.js":"1adf513b85f83f8f10a68ed707fe24ed1a6d912fbc5ef64ee8fb3309347f7b02","app/push-config.js":"b8fbb7f69ec84dea60a1bcdb43a59dfa69ce61e389b61c600214b53ae78f4d55","app/push-logic.js":"effbc67ff72b439f5280ea251f9ee106be99ec4f7b7b60f548c0f956ba330303","app/push.js":"6bf5098b5305fa649e88e2948d43a5849ddd074e1d7c3ef68b169d9cec9c2bbb","app/qa-logic.js":"e605bb5d82dac81124bdf25dde779c30f51553c2bf3b1764c3dcdb048036da50","app/qa.js":"17bf4705f2ceea66561ebe25926bf96fce5763e0fa0f1fac2d2ce176805a4c18","app/questions-ui.js":"2b72df41eb8da6a91250932eebc7a7afdaba480d2952a12f6be5240f15842be6","app/quote-doc.js":"5fc86fc5a5bd6aa5fcfeaf9ad83551759eecb93669fbddc4abe4b4a725811e6f","app/reminder-engine.js":"9d7a3dae3c60ac5cf9a9df319be77c01a39327a738569b54e21a65fc20d5c07a","app/reminder-rules.js":"8d7805480407fe66024f50f2e77c51539d5aa3b7ff27ae6911bf55110d22f228","app/renewals.js":"3172f3da40d75b90bdde10bce80de32ed99e7d9c063147642f58a47dc5366ef0","app/scripts-data.js":"3f1ee05eb7eb630f0371273b581064c4470b01b70816b5d037b4b2ffceeecab8","app/scripts-logic.js":"244b81636adedf277e355aa8c7ffe45d74c2214e0f231e21303fd0b2a05ae7fe","app/scripts-view.js":"71fc4e1f78ed92fa290ab16f1b2fdfcd55ac68897b31344a26e7a46273db8052","app/scripts.js":"ea0405f0aad0ad117fde3f0563e9718fcfd76694a5dbd153a5c337261dcc2cac","app/session-store.js":"99c2e24b015e8d59fb087d0f9871499cfe89784ab9e69ff87a179c76e631267f","app/set-password.js":"6c8ec25c4dd1ce3acf67984e175f2b2e18a16de1f9164adf85513a78317a0747","app/shell-gate.js":"55fc49602d0f14cc45be95e879903f0393d52a87830c4157bf4415cdfd7be46d","app/shell-rules.js":"5e770da9cbcaa1465d06539bea495f95a8a922c1f6cb3938f367863dd668cbc9","app/shell-state.js":"da962a1519f376df7d32e71e72afbd6912268c85ae1639e56c6596e1a14f8bd0","app/shell.js":"19acc78a87cf5b0f0542d78116bb5e5f7f0a354fea709ec84893e60b3088c123","app/shoot-prep.js":"a7e312ae877385f75dc81a7b1a10c64f5d209b089258ee44b337bedf2fa34911","app/shoot-table.js":"12f545104d622d5ded896d874ee1197103ff9c01de2090662f45d43dcd95e2c5","app/shoot.js":"e478a769eb8390c79bc2d0ee14c2fa340426b7864d1b8df8872663fadb58340b","app/staff-tasks-logic.js":"c46991de4524c5f888b6be82912360efb03e5c546017bb2dcfb6c98da176d0d5","app/staff-tasks-ui.js":"04dcd1ee3badaf45eecbe742cc5cd92cd614ff7b9e38088fcee3a8b6cf3e7c10","app/status-link-ui.js":"1eccb39ce64708ece8a2919e6ea242f19fe75bdb13beb3098be51f75aa73871e","app/status-logic.js":"4c0280003799d031780d18e1c485f9e6eb6e45cf7e1903b4916daf7f2a14ccc0","app/status-rules.js":"dfdb5f1b56427daddc776827088a24b109ef4cc3357375c28726be0c9ae2fbc5","app/status.js":"2f279845c0316b59416bc3baa544a6d61af1036958868b91ed69c3777e9b0023","app/styles/access.css":"3562d531d946a6f206e58aeaca838213fe52e345c99935675e1f381b001deab6","app/styles/app.css":"5d66912b5781c53dac4cbcbcf00fa89e261cb86acda99b2da1c165eecdb743c1","app/styles/approvals.css":"db8b30ed5681e8412eb7fdbdadc7d6c6a8c54ad28745aa9eb2f70b6b7d582133","app/styles/availability.css":"ecb194f7fcaaf6b6e3adae244d26828e7b02b9700c59d7a3d212cf5c8563bae7","app/styles/calendar.css":"35b5240dfffb5d17b57aba3ea31368ec1dbeef97908782c3d75884cb14c68e93","app/styles/client-card.css":"49f5042eaf29806090e6edfaea45c90f54aed595eeb9182d32e0e0e92fade86f","app/styles/client.css":"738c74dd9b66df69264ea22b5309e800fa58ee20739bd139845a8d7bbbd5f7e5","app/styles/deal.css":"afcec6a92c429134a703b38eb9d9afd3759275cc3f2095a3effc1ee1d1f36723","app/styles/files.css":"60c84c02e30903b6b3505ec9c9a83bda20b4658d6756ee22bf322d93f1e781c3","app/styles/gallery.css":"119febf95008237ac6fed746aaaf235f4e6ca09b13e17c1dd9f9366298f0d126","app/styles/gantt.css":"8e67209645f03047d7f9c1640e4d9c948c8730f17d486b918156cf5d61c5a357","app/styles/insights.css":"af7d7792817dd578270ba57d6707bae9d224e5b6f8083b338c7d6f9e705806af","app/styles/intake.css":"b36a067e482821b052bab6957461839f79436d99fdae4e7c626b65a7779a3047","app/styles/kit.css":"3a4c233887d61c25d08fc1508d8a72c727550450b635a05ebfa6713500441bbf","app/styles/landing.css":"9541f0bd3d73eeb652a6068cc3d44475461d3213da2de13a7f706284dba6236c","app/styles/login.css":"a2e4875337a6e8c6120421485a4cdbe7b1be647ba0545822f290ba7650f930f1","app/styles/manager.css":"0763e22b78e7b2d8cdd8eb06dd83628b01c05adaffee523b83a007a6b79ce628","app/styles/messages.css":"55c3126fcd365b4ece2eb462095c31304454497773d1946973b24c78590ba15d","app/styles/metricool-connect.css":"1ae0a0861a263a2ea636c6a522108a27d0ec1ccb06c57e1b0ec4b10724a31563","app/styles/nav.css":"5082a6fd68530185c4cd82244f53c2f61ed7fe6a61bf50219b67d2a8a63d0154","app/styles/office-flows.css":"09366e9eeb6460b4ee871f58eedd30972b38c2ad2a425f6a168abb1baa4ae8bc","app/styles/owner.css":"c39f1e613cb2fb86a35aeadfa424eb95a0dba510662642e8aef970980ca0cff9","app/styles/payouts.css":"c813b271cbb3d3f0e8f920caa5cef065fae90a68f91e303619133653e209c3de","app/styles/production.css":"0e6236938a8d250df483b6863474fdc72bb10070c3143cbb25aa8472fa9f49b3","app/styles/protocol-now.css":"7eef1b506d2474331a5f1e2022c01b472786a93a4cc85de909d9f1f98d1917d6","app/styles/protocol-office.css":"ced13afcecbb01286e89e48b5af692520a691df7ad3fdb06d46cf9f4c4d07ec8","app/styles/protocol-roles.css":"e147ec1fb63f2a5cc0488b16ecdfaecb1c63908d2d858b6fce373223d236a317","app/styles/protocol.css":"3d7706d12d1f474a7907195dd66dad0b9a56a90f2f60e4b28ecc270b4685afbd","app/styles/push.css":"591688264e39f072d350a185227a600a7cdb9ab97e68078aa13d63123798e670","app/styles/quote.css":"4d5b1baea5a7fa00286ecdc8b21ec0d8aae8d973dc384fdaa687a4f15694da47","app/styles/quotes.css":"0895d93ea7a158419a14a12fad34a3d1974c18847e19cc5f0e51c91a141041aa","app/styles/scripts-view.css":"da3b7ebd40571c44fdd4d2ba93d708f4c960d1dc98ccb3d03550f85f2ee10e81","app/styles/scripts.css":"93eedcc584048e8ffafbf8067b564ed52c88399e86cf45829677e3c286b6bfa6","app/styles/shell.css":"9ec092c636c8d9ef12a20250c30241dd6ea03818447bc7e585c4ffa6f6c74f8f","app/styles/staff-tasks.css":"5b1b6bdcd979781e8a7bb98b36f2ebb9bf73bc230dc448015417212f3fe5fd0a","app/styles/status-card.css":"3d2f386b2f7e885afd8e1dccf64c7faa944eb4abe7699226ca2c24cff6fbe782","app/styles/status.css":"84e895d17730bc44f19111add793153baf7b47b6adc8a872cac334317da5a79a","app/styles/team.css":"10bf6fc13f8f36c58fc063ddaa8cacdb6bd24afce2d894f99d82333239c802d7","app/styles/tokens.css":"aed87f86b6d9b3d5df647429db28eba13a87c968baa11e7ec3781c0ef2879e4d","app/styles/whatsapp.css":"043d77cee016735843592a04cec50b16d8bac6fd8fc61f99f7539fd216032a5b","app/styles/year.css":"af4875c5fb6dd7a1a3749095dd3d954b253bc4aaec4cd85569c0abcb72d9920d","app/supa.js":"29fa97326d9965fc3d7320a87f6239134f72f840274307b45194b261582e7d5e","app/surveys.js":"a4d4f9cd4e2479084c2f8f7ca24722eed3cf3f5372a0fcc9b8b7b5cd5ddd143a","app/team-rules.js":"87fbfad386801f29960a2a68d3be2fd165c29ff38f353657dbb77a281d010a05","app/team.js":"417c2cd9421e93e36d7b5f0751c44e5abe698704452fbd06529e8b073ac2b68c","app/turns.js":"ae392c891673fab2cdb38b39bced06725c99158d8e0bcd74e88b4935086f4748","app/tz.js":"ee0f143edf0a63b7ea240f3e83e53bbda2db1501a4e992dee63788fd0ec7fd32","app/unsigned-logic.js":"3f26e386c394fb81d9eae0763e65f1b57056424a7d239f57037d47d4d95514fa","app/upload.js":"5e851d69cc1f253be0c2533ded69efa517add9ef0323bbae9b47b677a4ea6c77","app/vault-code-team.js":"8e86d0950a13a4de6b893a6d47a8ba083a69c3c8a0500978bcd43a2f5c51a683","app/vault-code.js":"185a9610edde21c5402949f1ca3a9adc3b93495f7673dec38e7ad3cbfe9ca30a","app/vault-gate.js":"d7bd533353ac0d03875d4ba7967a5282935ad6e2df6b27372fd207a46a628f03","app/vendor/supabase.js":"649e46c496fae692ad4fc75ee1a9da5315f79029267cd4df847e7de192cacf77","app/visit.js":"224dc4a0e69dae6d1a4b03038509b09a68ca426961f7d7902fb31c394e75ed34","app/wa-logic.js":"03735685c30cd2b428fd4b74b4f9253891dc8f500f2c9622336ef8efaa921b4f","app/wa-team.js":"114bce61e9899d4f373532d3c8ca2d852beafe2cee0864e6876d52f2f9aab19d","app/wa-templates.js":"18ee85d5efaf5e3ca5ad0ab58a94edfdbc3312ecd9f30990b7f903da97ac65d5","app/week-chart.js":"2399112320f3aa5c48a2a45ceb2d9de8c1e0ffa3163f7d75103b44d3b528cd36","app/whatsapp.js":"c6cae6fc1ed6a6372689daa49cb90fbda6fa94527ccb0769950569cfdab62f78","app/year-data.js":"a8c652ced94694b9794c3c71e27de06853e2422eb5d4dbef80249c0171125c74","app/year-logic.js":"4c2d7c7e32897837391d6a499eea264fbb8762e5aa0eb5e9697137d7c35313f4","app/year-rules.js":"7b2a7201d32ba774ec5b5f6b15ec730e257bcf3f33ea0b13d29c26951439e87c","app/year.js":"f2d5ed2eca2a09c1b85b2a71fe3bc79e94a1608d57b426dbbef517033460f6ae","client.html":"0e0ae28938275348c1853d569afa035bc4adbf14567c8a877fb7699a4aaa389c","clients.html":"30960fcadede28857708a8e8945c93a85e41602f5f8a8de0a890b51d6a4e1ebc","clients.webmanifest":"26db9e715f603aa852bbfc7d347786b46a93148b00f53152612eece21025655a","deal.html":"648962b2b503178a9cbc093cb1ef66f4d819be4f6c41b5000d3316e071ac63c4","decisions.html":"eb3acc68d12ddd541e766441a72d5544630e9f98074b883ba742bce56bf95c44","editor.html":"e2a34660d699bda59b61ed70420fce57940f9083c2a4c699dd79ff8370ba62d4","gallery.html":"bb1f481f6c49358e357c33ad2b275e647624d8aaa58477071a051816c7b6e4ba","gantt.html":"71a5ddc5eda6e9ff1def760c9c15d07336bccb90806cbe5c1f697ab826ccaa8a","index.html":"5be891ff080b4285ef2631f6419f3c79a05003e58020b6883d9ac92d278e9971","insights.html":"d75167c3098e45f8ad9ec4c946926008b312b0f5b499d37355ca1084b104b785","intake.html":"4ed94b2f980e06e0017802040f34d10fc0106f094d48bfd37b7613c48c8499d6","landing.html":"2daaf1945571cf44920b35641ed2199f48b7b9c7e0b9b5aa30a5c265d86b58f0","messages.html":"ef274311feb9d34f82794fabaf8c01e84c7036970a9f778599126d88c7c5ac55","owner.html":"7ed8dcd171c4920007fa91a9b9a8bd46a36d254ceaa1d58a383fc1b1d47bdba2","pass.html":"7d57e5f54df9ea21c1b4267386e127d9d6f457a2ec0b87534b632f31ab9f0e11","payouts/icons/apple-touch-icon.png":"92be9723bfd93667664b9b95faad98814797f4234abfc18019ee86913a379b4a","payouts/icons/icon-192.png":"5a91a352273691a55273d1a4c18461de1d259b63c409e711348fefe59d1378b8","payouts/icons/icon-512.png":"56a1b7ae11292a27300ff62fcf5882d4b617f756176bf1d42423275386c3dd8d","payouts/icons/icon-maskable-512.png":"63e86d4264628005c7cbd01c7af0f5e61dcc76a1a3822f37a5785d3a9a2ceb8f","payouts/index.html":"ea2dc01ad9468ce7639c25f6199b89f55623d1bee253e4e8f2ef196c375788ad","payouts/manifest.webmanifest":"826378c942f268ca87f6208bca8cbc8d73c8d578c62af9db3a4bab6522dc4855","prep.html":"301a3a48a22845eb181d00dfd7a2e4cb0761a149d39819d182dbd72a20d8e914","q.html":"a7e8af3c72565e4246c6f5901edef79de861bfe0d621baf291527be0ad0718c6","qa.html":"b23a0e248e60ea5f6c9b7d9b7bc5c02821f34a318168058988bfb7e52899578c","quotes.html":"f4dafd1f24ae680d0850bcbd35440dd6934a7167034571855fe2f266a6f48940","scripts-view.html":"5edf77c5df6ac42a04335cb6f2a5a857287bf25e11dad713adf90faa78854485","scripts.html":"584ba3249261f1efa9347b77a2fff88c69d79404321628d19f0d374e88d4942c","shoot.html":"88132babca7f6481564c8b33e8932342999bfd9e7298bb1a025afd7c418caafd","staff-privacy.html":"7c34fce36252de1e0cc0ee82e34b7b0cc03193199f4621124f5298e985682faa","status.html":"6756f8f5364962d80f891afe8ca24a5e7a1ea120a9226cc6e9c8a7854c0d8091","team.html":"1a456cfc14c031ab450c8b7bf6d7d419302c36a19257086925c04f28e8211507","year.html":"edffc14096ea0bf9fb1fa3ed979e8eff37fa28fa40cec3a0e879cebfd0870b2b"}};
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
