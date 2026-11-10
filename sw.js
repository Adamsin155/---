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
const BUILD = {"version":"6f229a0cd1f65760","files":{"access.html":"925bade00174f5809b79c1bcbb874be2bc0eda5b3911c25b38fa4ffa20e89444","app/access-check-ui.js":"da48d8533a5b50511e9b7e1c7113bf790e0791ed094f455448577c4835a925cc","app/access-check.js":"1e24443baf7c300f643b5bbbccbbf971fe5c618ad9d2fb54c8c1fd0c1d928988","app/access-data.js":"81b0491e6d733b5525edc5437b7f7f180ccf684a13f760033abcb6c3a9ea64ef","app/access-form.js":"a76b118001574aaf62610ae7cc86764aef2b17c207cb9a181e98f42217b73248","app/access-link-ui.js":"8710222a349bfed486b9cd675f7588ae0fd9653e61318e48d5d8121efdf2cf85","app/access-logic.js":"c3b2599edf933c6baa8296e0e8641c4b7eec55dbe1a7960893afab8de15ee147","app/access-nudge.js":"1591ad693817b357068ce891bcead9fa043175c2f95868487b1b0a584d4b3f1a","app/approvals-logic.js":"dc508a7536bfbaf41a12df25210331cb2a9655b8d8e89abfea38b48c506e7f68","app/approvals-ui.js":"c5ce3b45c573b7bc1afe9c65ccfa7dea9fdb20c5c9bc481e97580e5de175e39a","app/ask-guide.js":"6f43d132a46ee2296e35cf8a7e5f91c61781bb587876d301bd17f2872aed522d","app/ask-logic.js":"259d7b9e5a8d00cc806b31ce9c62fd18887b77b1e96ee552508dce6f09bb6ee2","app/ask-page.js":"3db2869e75e1196bf4db51cd43fc939c8e34367325ba00758068b29ce57580f4","app/assets/logo-mark.png":"2cd2f349d456cb9b3ec6296cd9f069f1ffe65d1bcacceff8c878067d812954a4","app/assets/logo.png":"f3449f67c8e000b64f4b70e4e1f4d416b3461f5bac4b3c8bc4bfd281cff826c3","app/assign-dialog.js":"f0401e29b241bda1a8415ce6aa591d8e8fc732b545bce510f9bcd948ddc5a69f","app/auto-assign.js":"4f81af99bd039c217a7a348022fdb045595deeeb3321dc8b2c41625e17340ee1","app/availability-logic.js":"1910784d3341b6cf7ccff10fdec8af8b99c8e9d60fd96b7a4a265fb7bfb42bee","app/availability-ui.js":"c224489aff62d4378a3c15737e99c27492171c278220da563b0941dfeccfa844","app/briefs.js":"84d702fcfa7640ef1152dba3009a3720e0bc89c888ef5f9d30648b6803a44c88","app/builder.js":"2adb333ce900498a02d9d014b90dcc1b806e0b4c4be34ef757f8a459a88b9904","app/calendar-card.js":"df0915780ec8d93fb45735960f270adefc5ee165bc0e7365824a2f750b650344","app/calendar-feed.js":"c9dcb1a6b946059b065b888387a2092c76aef2a95a8ee9b7e813225d0467a21d","app/calendar-page.js":"5d6c4f17027cf7512e83ef269ca406e5d49f0fcfe62a0e0c2d285f20cf386d84","app/calendar-view.js":"639c3ef2b740c3b92fb63b9c7f60a7c2944ef482d0e19cc1b611546fc17d8552","app/calendar.js":"a3d90813076a9bbada79b19b1a58d1ceea3db780778c274edd967d48335a6756","app/card-assign-logic.js":"209c0aa7c4c915c0bece20ca6ed4f134519fe8c4545392357733ddf11f8beac3","app/card-metricool.js":"12eb4572d2ef53de67a5552eeba6b5aedffcccc4d00427679c352b790c2049ff","app/catalog.js":"a4b43576a0c672b0c5e7eacd2c7a3ed7601923bfaf91fb0fa56d5b1587de3c3b","app/char-doc.js":"9c90d23555e1288b5d11dc66b7148852fa04636e45fef52fa894f2bc583aad77","app/characterization.js":"182c4c95b597678443c157e3f8ed5008a064d0ff14d1de78ff5176c636e35363","app/client-card.js":"6bc0484e2792af79dd5d2e378f9821375820867114c79d3c18d3dd9921b1d1f5","app/client-contact.js":"4b2a455fbeb79fc3b85938e8fbfc1dc8bcde3997cacdc4fbeb477d7232dfce7f","app/client-links.js":"3b0b9d9f37fcde761e125f8789ae5a685da13e477b16863528f59481608ae035","app/client-open.js":"8c500e6c5987ae1cc12a90f0f309205e612f75a9717229e1a878fc1eb6a6c7d3","app/client-search.js":"7b2441f9d5b963a0da4b619ac954481cc23218f559ba6ccb17dc9a1c3cc875d9","app/client-waits.js":"26e40be97dd7fae399b3d4457f05da772f1ec42ccacd966ddbb8bdba0c91ebf7","app/client.js":"4a46735b73393cfa00a93cd83546068b94ad444019c97bd650a49ac2d5644cc1","app/clients.js":"f23b4cd47013a9cf878a067d383233bfffc862ce8d33178782c629f85bd34a06","app/clocks.js":"4129aa091822f9546539b8eb5263759cf17af37e995faabc0ed84b94ec3ef886","app/contract-ai-logic.js":"14af2682ef1bae1462ab692b3f93281ec2ebd50a849f5c27622c1b32b83f2a19","app/contract-end-ui.js":"d98df7952bae2974b3f93d4e8558699533a66bef04c6319f06c7b9210a3ebc37","app/contract-end.js":"b66cecd558d1d652468a99a3c95a2845e02fca302ff636921fea1bac165ac10b","app/contract-file.js":"9fd883b9780ce1bae4bb4257c652f0a1678f6c840a7d96cd20ca8d697bc82032","app/contract-read-api.js":"c937652122652488fe0c41e7ddbd85286b2b6934491584bbd5980649b02d7776","app/contract-read-logic.js":"85cf23b30734d5c3f35e395ba1e17c5535f1827c24b5eee5e68906f031707a18","app/contract-read-ui.js":"37e24a489e0c5b1d9301f7205ddb22a616f3a3eb712e3bc41af0d13318982fc5","app/contract-summary.js":"07b55424ff9bb34b0340a2478178249fd20443129d1af02114874ebb0c8fe18f","app/control-topics.js":"56e9f4cbf4fd5ea372cd9080aa74b56febcd675e8d7c1775c4d053c210d8a61a","app/dashboard.js":"1cde3157e9e796468e7385b023249a70bf1cf35d44f06216cd7269eaf3cb959d","app/data-cache.js":"244a22e145366982393d98b9e0dcc4a8e09b4afe2118a370a7f46c6abdacb2f3","app/date-set.js":"ccbb1f9b8092407f8e65eb9793435db3aa3bbbace5be893a0eb8219db29ff05c","app/day-summary.js":"a493a62e7328b73d84039ae79c77190bc5e2cb035556dff773b94e030f6209cb","app/deal-data.js":"6ce544fa820e66c78491152729995a4582497f56c87e651a8762398dceb34ed8","app/deal-logic.js":"21c6bff415fb0d1c3242e550b10a5e76c378d15b3a96711fba52bf507fba16c0","app/deal-ui.js":"2c78438e9c26fe7e8ca76c3fe73c608d5fbbc58a2d7ad639d8a0fbaab11dc5b3","app/deal.js":"568d5f597e937f1cf66ac63e82bd69b4ff4f51453414491e4fe7659939f1c919","app/decisions-logic.js":"bb62314cd87808dba544a9d454bb56465dbe062ccc5b08b34e3ae5a6e0992626","app/decisions.js":"fd00b92898f75c32071dbd911e0287b30b2a71f5af343482100bbf4fe0b7b158","app/drive-links.js":"d7d90b17a5d280089e7ff55abeab65f844c12e773110e72e66a5441f593f1a35","app/edit-count.js":"088c6208d11e760184097bfab292c90d48de9e340cd47b0dfe22830eb75e1e1a","app/editor-auto.js":"2adc12d257af22f4d0171635fe7d51fccb45872c70d4e3a1d92b2287a34e1ea2","app/editor-order.js":"b5088166bc31046bf6ff63494b874a261b8765b4c6d85e4b7cbdc2de3ba1ffbe","app/editor.js":"bc636e6d290264936d69f6ef1c341351667561d4d2fe429bc22ad30bf5a762cf","app/fast-ladder.js":"1e03546c76a9a35acf235bae665431db553de4fd4623a6528f9a7849e6967938","app/feel.js":"59e125c5ec2091ad8745c03d9483be37d259eaf865a897218b02da546c9534da","app/files-logic.js":"d853faa7d839180cf4eaade06e1287af3ef29c8274315280f18bb0a853a16671","app/files-ui.js":"d243aaaf2654b278046773fa164dc250a0b717af38dbd617fdccda28a850448d","app/fix-request-ui.js":"237abeb2bfe053807e3ba66285184dcc667792c67961fa1c8f2de78a329a090c","app/fix-request.js":"f949d7353fb9b739491334a8390da73431437fdd607cf10be48570437ac3a970","app/fonts/OFL.txt":"5163e9f9fda30f27c95700c375293baaf841afc890d8a8496113bc954a19ab7f","app/fonts/fonts.css":"84aa1405bf6ad2b9254f23e2afbe389d852308c8c4d8305fa97e9be4d28e2236","app/fonts/heebo-hebrew.woff2":"f1f7cfaef59431c7b391df81fb05520273303840bbe917213a2ab9f41b839675","app/fonts/heebo-latin.woff2":"50dae2e12dae22c920388023e35aaebcd1e1d27bbe915c83d64210377e083e60","app/fonts/jetbrains-mono-latin.woff2":"18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e","app/fonts/rubik-hebrew.woff2":"197b6dbe5c6bec7276c59b02d70a16ee6acd44322fc2f8d0226c07f8d57976c2","app/fonts/rubik-latin.woff2":"691cd1d9b4c0cdf31a1dcf04259c86f92c85e69f6622abab7964d81e36890691","app/fonts/varela-round-hebrew.woff2":"61f49780c3763145a924f538636d2e4aa190d614ea44a190758260896e4d804d","app/fonts/varela-round-latin.woff2":"03871f86c86fc776f89d0cb947502f3957181b63327fecaec724bc39d082319f","app/frame-guard.js":"b6e68dfdeab0aefbd99ae86d6138a4a99fc3e23eefba5cffd373732718a063c9","app/gallery.js":"a1f6ac4cc72ac8abc5a5aa51c7b7e91410a62fee337c535219c200ef98111476","app/gantt-auto.js":"3bae01a32525e5f5fbb53095ba866f047db95196a403f6392b6cacada1b841a4","app/gantt-brand.js":"fc1feca683270973a018306fb84d322ecdf28931eab2ef5d1f91bbc1dd11bce9","app/gantt-data.js":"2970f9c7c85b264cd9ea21a249c10d883243a75802a8e47026e5ac74e4b77ec6","app/gantt-drive.js":"40d1c6f2dfdd7a63c32466ed5a9589106e730abb0fb82fe8396bad68f6092a31","app/gantt-index.js":"0e09b7ba902bbc23c92ec59a3ddbaa0af62015f9e92a0aede3a258134ad617c8","app/gantt-logic.js":"a4487c1ca788b602f77834e31d225a3e449a1891b08c958f8bfca39652f6f1a8","app/gantt-template.js":"d64560bce00d1a4de816b99f839f07d6e7c9108ea77218ff5240a41a51d1eeed","app/gantt.js":"bda53071468aa437e8cd622029806201e4c57fcc96fb6a233a907001d80a6744","app/gcal-logic.js":"47cfb62d955f04f7627073e575e5759076a4be6251dbdaef415dde9b283c9e2e","app/gcal-page.js":"7dd28e9657536f98e9e601bf1eb17cc5106f7216901835b9590a670a876b3db6","app/handoff-ui.js":"f7af5179d0ed29b8deb8c1778bf05d27babb1ce2cbee77077afc395f4224a09f","app/handoffs.js":"c0bb8942c14d74a91a6979a46de1a915fc71337f7a241fb9e022b1130ad8366d","app/health-ui.js":"114b88330f76f0d8d2ef6dd949428129dd069a6801ae84e07fb4578437428177","app/health.js":"11c290674afedfba53d57cdeed89467455bd61f403b0021510ff8e8106e87dd3","app/holidays.js":"abf016950aad8ec6044f8b59e21bf1865acb6c6cbffd5bfe38e8101935d75592","app/ics.js":"7dbc44707f531580f05eef0e5351e924c09e6f14b8488bc855b8d619f33d7c8f","app/ilai-card.js":"8e11dc71a16e649dc33877c06b284f00a01ad987b5be25bc31572e80ec47298f","app/ilai-logic.js":"391cc17e1dd4fccfbd20a0c2faa3501dbbc63b0c39e22f37f779cb953ed1839c","app/insights-page.js":"35dd2b403fba97a2e9860a9411b67493311240f6f123af3a9fc5500435a4cd5c","app/insights.js":"f5f52be9b275d7d976120d56b86967407d94f9e6992a20cda5b5debc23047ffe","app/intake-data.js":"77da50026e126f8c0fc46e874b57ce516fb99c32b2ea976751cfaa4fe3edb3cf","app/intake-ui.js":"ad520016dd425d47a9ac1df1a529fa9a6355e136fdd532beb4e4afa69d3bc774","app/intake.js":"f414eaed29a1bbf3d7adc80be5d1fbd85d7be2e8dfaf49a607dff8bb41889b0e","app/kit.js":"f23a96f50d5c335b118b360a49e994686bc88711391e59791d0f7e07d9909681","app/landing-control.js":"d0f8b07d3fd31b251d4ddb3aea6a35e8c9f3870fb09541bea8c6f1bd7785c196","app/landing-data.js":"03afd7efc0d1c60da64a839fc93ab0ff2620938ff688ee4b5d49c4d88817076f","app/landing-link.js":"b3c35c84126c0a695aae027728057a8b6ebdc1193eeb69771418d1528a55cd47","app/landing-logic.js":"9481e98c75600aab0048b47de1446d8e299fcb6958438a3ea6cda79e04d5f2d1","app/landing-ui.js":"7b039fb6188f415220f250c29df757291c04f337c12aedb2c3ed12733bf48751","app/late-chain.js":"0dad81bac7c804bd9f43f3749220b60d3f11acf3a8333d7a11163a9081a460b3","app/legacy-char-data.js":"04fa38b8e3521cbb8995673ecf4d1d822c6bbfcadeba4880cb7e5a4775205ba8","app/legacy-char-logic.js":"dd30f42233d8d458b83253828c8c5b73b02a7c80c5a187467cd4552015106a0f","app/legacy-char-ui.js":"fae67fab1ecec0d0e53012867c014eacabe1e38476870c529f8e91059f088c18","app/legacy-contract-full.js":"d3f3e8ccabc9085a6eea4e6df4cd12b76eaa0fffb78842587078fdb080309fa4","app/legacy-contract-logic.js":"8130d09795727d8650b23d9e76ae261bf940b3d28720357db0ac1b9c1c8c95e9","app/legacy-contract.js":"2b963f0b48ad4fe7ff675a4c0beb81297707e2aa717df199e07e3e0e904b1b6a","app/legacy-contracts-data.js":"56fb1bb66e7fe51f13fa8eeffa2382194b8f8f6f9ce2aa57acb724b284fc26fe","app/legal.js":"397631aff22bd138bba5fc121c2c9a8ae25d7066d06b0efcf81605c645f6d821","app/link-token.js":"4c7071749b1b38c57d7915fa3dc1f2f887080f74a9ffeb5f7b50076b5bf6aa62","app/lior-four-ui.js":"1540b8d29d415a1c039a2bcd638c012c72df10ce3896093ad0520488f8caca42","app/lior-four.js":"796d1000643d3bf6601650b95b79f39a4317c6dd327c40baa17d4d5e8efad504","app/log-brief.js":"c29e74e90867ba2e00d175e71ecd5d4da3d1fc92beb0560dc4f59bfe1d0a0802","app/login-gate.js":"a6ebfb294aad632130bf467d6a8818c653e156ddd185eebde6ec7041dffb730c","app/login-ui.js":"b8f309f41bd2bf79907903ac152e281ce93cfc340fe9d1f70ec3a2e2ef0916a3","app/manager-data.js":"85597fd7742480743c6e82fee52684968d53197b69821fa41ef8f2fcbf2c0147","app/manager-rules.js":"9916a44e43d97e4783a9960f5c7dcb6ebf79b57fa9172816800d046b2b28aefa","app/manager-table.js":"cb751bb655e165d9e6d8c996a49006fbb9e223ee5540dedc72dc464f26906dc4","app/mark-guard-rules.js":"e21d1f65808ac16561705a333b9ca4d0373c80e5485befc699af74b3977229d6","app/mark-guards.js":"20df49e94f36dd815c2ea630ad7bf8fa45d76bb00b8dba0da16b5b34e49f5b20","app/mcp-consent.js":"4aaab030522f11c9e8dc27c85ee8ffa9d106d245d4cf7cbc539fadb6925765dc","app/mcp-draft.js":"a1a7b676d72f7fb3d53763521e72c570bfef5b03bb4f87699f8579989b2df819","app/mcp-logic.js":"98dbb44aa5d5c560cb5e7c944d5787545e43d2ce2766c17c630287b1e3493532","app/mcp-team.js":"27559d2c4285e2d5b70b6ab989697d0178a9a209bf25fcbb3f275e2b8a51b726","app/messages-logic.js":"461078c0a19f883a7f937266ac8c6252883d4a561e9b81d38374ce4669bc315c","app/messages.js":"e2ba999a9b0969d7a5d6cdb72c43877fb4667917ed484712df36fe880d21c60f","app/metricool-connect-logic.js":"3c2aefa93676638ac26dec2da62ddfca8d783afa3acdae62170c5c8b1716a8b3","app/metricool-connect-ui.js":"017687954c5fcd42be7005e6c144e1f822d4e920d1f852b7a6153fe159058560","app/metricool-logic.js":"ff25c2c09a1857f9698a55b560272fdf66fa12770ca5ca9486a9031e2b6a4d50","app/metricool-team.js":"976c84ccb7087ee84c61fae2fc146c075c0c525cd2957bcac83ca5252719f2e4","app/mine-connect.js":"6c26da0ea8d25b13f8cf1a79418b50558541ddee6adca7c404cfb066b70452cd","app/mine-flow-data.js":"b3d4782660a54d68d4219e7f53acebfc7d7dbbc0103765ad988ff02a971cd16c","app/mine-flow.js":"5a7a14694141a157dac5aa7b51334c0bb19b758f6b4e4cf2ba9869e5703ddeba","app/mine-metricool.js":"3c306431850994e230ea2215984eea601834d69eeb95cf693629e6d566010748","app/month-ui.js":"3b3c8c2238088ecb6e8732444853943f3d9a6e4a4750723e8f26766c9e1cbb10","app/monthly-rounds.js":"cf00a50542b077a202a647ae5ba73210f1a21e2d357d265371fae6cef94cdc80","app/monthly-shoot.js":"c8d4bfacf19956abdd732e9475656b1617509100c34d86efd95665def70e31d3","app/new-meeting-logic.js":"a56d1fa0aea7e7a3b8d9243f8fcc1126522577c8a51dbcbdcc2b24d2588f6ddb","app/new-meeting.js":"7d273b4bfc8db7730d75d1f3b1f80068d66bcdccbffd233bc46b1309bb75f6bf","app/now-bar.js":"f2f8b0cb4ca25e9fe2117986c9849f82cdde4f16b3c807eed3e183a083336e1f","app/office-data.js":"154b2cfbd2e87e450176267bca6abcb788d412677c865f1be3175ab2a926a839","app/office-marks.js":"b7f530c25d78b3e8e486e721082089c8fa56a307d39836c01569bcd8812c8edd","app/office-ui.js":"588356415a1025aa85c52849324b32db3dac9896d88afdf06670e59cd24365e4","app/owner-data.js":"0348c0d304511a8ed3b2c2ab761e8fbf2ef81a079084f21b619409b2c1c60fa0","app/owner.js":"76fce4feae2ecad4fa36be425c74ed5da21bfc0bb7fc36511fef37f42bd809d8","app/pass-logic.js":"5a71537381dc86680d8e9ef079165a952adfd85d6a24d9ddbe169e3ade2c6416","app/pass.js":"5e910157763c7be0097586619f49e2c6ac53fe2ea0c6139aa50b9a276ecc5c29","app/payouts/app.js":"54ccd8ed9b1d10084ffe5b23644ee555b592f586a8a3ddd05b8bdc1d0912d8ac","app/payouts/client.js":"0931a4786e8a712694137ceb2b6031366818ae6d4efb64768b4217d355b20ed5","app/payouts/data.js":"0a7767abdd3eed3772571679b435ce4b827c451b66fa5e30c1ebc24343e7b6fd","app/payouts/door.js":"532ea19714e99897c7eb57fcd1a181932e05d89496f482cf6be0c846ca8ec03e","app/payouts/engine.js":"831e3f89ff5db0e9fe5c606ba96abf4cf9dfdf1aad536040a4100fadc9f7bd2a","app/payouts/gate.js":"5409be7ed9a7d3d6147066a0ef0ae3a12dc7a91831207830f79be140ea53d5de","app/prep.js":"c65691f56a899e9da019354c1f001ff4afd36ed6ee1835c8ceaa15fb213af92f","app/pricing.js":"5748393c43776e1c04ef8d058e92b7307ba3d211f75ab097682149be227375dd","app/production-data.js":"ffcfc55090cd90e524ce322b2bbab48bcd582408fd7454a7dd04b0f60d5d942c","app/production.js":"fcb4b3b9df96bcfda55d5516c9e2af24fdcc3a0738385f3e0e03dc1267fcd541","app/protocol-data.js":"0e940800e7e9c20a93d5b2f42d1e946d55341a83fe582f81435db9aa4af6c82c","app/protocol-logic.js":"fd3abf11ea754c776158ca9d78a5a888a7f0effb77568876835b5ceec9708327","app/protocol-ui.js":"9c00a1569117d3903b126e8a4f03138b658cb6b1d1395ed96e90ee406ce7f40a","app/protocol-versions.js":"db7bf32d19849075210eb5b094db5ef885b2483be0e19cb139997f6a423c1776","app/protocol.js":"77cc3f3b12f06de11670cf71012615a2c2d54188d184f4ecb00afc5fbe0f3988","app/push-config.js":"b8fbb7f69ec84dea60a1bcdb43a59dfa69ce61e389b61c600214b53ae78f4d55","app/push-logic.js":"074ed6ec25a3412ca03387d8b030206d31d54febaf134aa2c82651c7ac9234fb","app/push.js":"888f2c6855037a844979b5d38ea8ce281040abd72d2ecaf01782dfe794b7bd27","app/qa-logic.js":"b311ff0111aba858f033e1402a1babc24af7f7f231ab40b44c9538b6070a9c98","app/qa.js":"ebfe1a8766c5b16436532f571901c5d8bc9c317036482e7f1f596648f6758ebd","app/questions-ui.js":"2b72df41eb8da6a91250932eebc7a7afdaba480d2952a12f6be5240f15842be6","app/quote-doc.js":"8756d61c567489ff8936db60057d86a1df8f75495c4561ff151606596def1cc2","app/quotes-month.js":"eb3c9c2a51abfbd33d770fd1c3e628cd13d7d953dd73c2e18a01547ebbfcb77e","app/reminder-engine.js":"99ddeeb483ac89c197b313b8e9fa738158e737452d09270d4eaee1226f4c1dba","app/reminder-rules.js":"7cae192f774d60a5ba999b88707621ee1bf8382539a0832d8d421e914600d472","app/renewals.js":"d2bda706f4b349703660bf079ade8ae78441c7c84d4647ce7924676a57563d1e","app/scripts-data.js":"3f1ee05eb7eb630f0371273b581064c4470b01b70816b5d037b4b2ffceeecab8","app/scripts-logic.js":"e7a56a59654c9ee049a92ca0398c875708a4f68aaa74755e0a78d9fe12383a4f","app/scripts-view.js":"71fc4e1f78ed92fa290ab16f1b2fdfcd55ac68897b31344a26e7a46273db8052","app/scripts.js":"ff35c9a19d1834b4425b85bae7bc158ea795ceff884b9b7794400266e04d926a","app/session-store.js":"8367a1e114a3acad37f2fb259b7a371bd98785e359eebb54c4c492dc9b5f836c","app/set-password.js":"6c8ec25c4dd1ce3acf67984e175f2b2e18a16de1f9164adf85513a78317a0747","app/shell-gate.js":"55fc49602d0f14cc45be95e879903f0393d52a87830c4157bf4415cdfd7be46d","app/shell-rules.js":"49a88051acbe603fbd707a85b06033a86b4154f879a19c0b797dcbae09e37538","app/shell-state.js":"0101c5d0ab3d81e916342657f37579f68b98a3a63f8e0727104c7a1dcb8da195","app/shell.js":"6f6a439dae86c0dcced777cb8d156febd088e8d3e8f3ff6eb4e2e64bf31fad0d","app/shoot-crew.js":"43fd099136600c3097438a7585df7ed393c27c3258683a10f4ff776c0699729c","app/shoot-plan.js":"b50a7d410130527a34324a1a148e1d1854c54d9651a3894ac7a7271066067148","app/shoot-prep.js":"6a06a4b6e50b1686808ec423838ea77b38496046bbed22bb5b677f6f931fc2cf","app/shoot-table.js":"4e711c3518411af5f6bf88cc6fb2812a0b3465ec413a532a065d69754a6565aa","app/shoot.js":"c4f9a54d6c6229c89d0e6c68caf41597fda685cfa90070f6d9870285799ee7d0","app/staff-notes-logic.js":"2205da6a5648603bbab8627d0436b43db052d72aa1e05424f4d4e7e7ef3e5aba","app/staff-notes-ui.js":"4620381ed45aad6c51c10071b7a80dce771574ef1fdc7253db5160731766ce31","app/staff-tasks-logic.js":"b7f743c309d7ab08f75280aca73acbdfa2705434d3350dfd2e8d01fef8eb936b","app/staff-tasks-ui.js":"30bdae4da8a2e675ea968bcef24332cad4228d4303cf96c6314ea5142353788a","app/status-link-ui.js":"bb2f2108f3e27c2131f0aaa566a40c4d8f31422121ba395e28bdedb1798682d6","app/status-logic.js":"f472cb53208120d52287fbad801de1dd7698b1c6686172aa160c841a7bbea00e","app/status-rules.js":"dfdb5f1b56427daddc776827088a24b109ef4cc3357375c28726be0c9ae2fbc5","app/status.js":"2f279845c0316b59416bc3baa544a6d61af1036958868b91ed69c3777e9b0023","app/styles/access.css":"3562d531d946a6f206e58aeaca838213fe52e345c99935675e1f381b001deab6","app/styles/app.css":"76f4369811f93d90878bb139313788945d629dd0124c8a8b533f1e61ae73a4e3","app/styles/approvals.css":"b83ced4bd189001b058aab213b7a5b02128f8fd096deca080a85fcaeeabb931c","app/styles/ask.css":"b20769327be92b64f01c11d30886ae189e1fe1c28530a0742f319354e22f7230","app/styles/availability.css":"3eecd9efa885ce9525a343bfd1bf2a551653387c4926cc3d3c5510167d616736","app/styles/calendar-page.css":"c8d03fe5c62bb927c0385284d385ea82741a0fb6c88dfa04060d4ac8c7996d24","app/styles/calendar.css":"35b5240dfffb5d17b57aba3ea31368ec1dbeef97908782c3d75884cb14c68e93","app/styles/client-card.css":"7df59104a8749f8e18dd3f460151dadb39daeac89e017dd8913bb11a8d823a55","app/styles/client.css":"738c74dd9b66df69264ea22b5309e800fa58ee20739bd139845a8d7bbbd5f7e5","app/styles/deal.css":"14c834092fb6c9989033094e8f130e16023a68b827201a53f630ba8165516f38","app/styles/files.css":"60c84c02e30903b6b3505ec9c9a83bda20b4658d6756ee22bf322d93f1e781c3","app/styles/gallery.css":"119febf95008237ac6fed746aaaf235f4e6ca09b13e17c1dd9f9366298f0d126","app/styles/gantt.css":"b3dc1f85c76cb99cf9c608903087db70a23776962b0f836cd6a01aecb03914cd","app/styles/gcal.css":"d1b71b20244bb1ec2cb617328f75062b0103013e21b32361cc916832936737a0","app/styles/insights.css":"a2c72392f0ce707861c9b0d852a1b9d00414f764f11623d6a8d60075002aeff6","app/styles/intake.css":"78e638cba4ecd98e2e91ec51d40e91bae6f3959f227260de402ca7fda450b37d","app/styles/kit.css":"c74262bb54dc10d71390993ea4edfe699c439e92b1f67f2a3ed5a2cb28b493b5","app/styles/landing.css":"c66a09dbdd518f46786635e057ecef0c948746ce5788ebad564bd371a4079d53","app/styles/legacy-char.css":"7c980e39ac7f786b29fa8453388b7e59474b208fbad79164c54b8950d5b59647","app/styles/legacy-contract.css":"3d3943cae4ff8fa3cef0e0eb53cae9c2166aceee514237559ae909c2f21434f5","app/styles/lior-four.css":"e18ce993d9ab33acc170c886d7d47780bc2c878bf17c0d2cb1d19c961bbe4a46","app/styles/login.css":"a2e4875337a6e8c6120421485a4cdbe7b1be647ba0545822f290ba7650f930f1","app/styles/manager.css":"a88f988be4f76e0d77e0652f90a09df1d27e6eb15dbb3c7fec73efbe1e62ce0c","app/styles/mcp-consent.css":"241c86f91e66dcec89b41032347de56fa10f26193cccb1b2501c8bd542dc5758","app/styles/messages.css":"b03b368e59ea379fc578fa4627e5433b4f9db50ed8a6d63d8269657dcb7d0d84","app/styles/metricool-connect.css":"46a4b6954814f867f089807a0acd1802a34e32840a58d6dd12936428e5dcb274","app/styles/nav.css":"5082a6fd68530185c4cd82244f53c2f61ed7fe6a61bf50219b67d2a8a63d0154","app/styles/office-flows.css":"15ab64f4d83279805759df154af73c85897f0b40a1bceacade924b4a098f68da","app/styles/owner.css":"1eed9791996f9b6ed3b1c64fe3f11b35b3a7aca887431f31c1aff924d439e2f3","app/styles/payouts.css":"c813b271cbb3d3f0e8f920caa5cef065fae90a68f91e303619133653e209c3de","app/styles/production.css":"c0457838e0580a3484ad2065bbd9252047b2aa3009a4d3ea10c80f605b3b4d5f","app/styles/protocol-now.css":"7eef1b506d2474331a5f1e2022c01b472786a93a4cc85de909d9f1f98d1917d6","app/styles/protocol-office.css":"ced13afcecbb01286e89e48b5af692520a691df7ad3fdb06d46cf9f4c4d07ec8","app/styles/protocol-roles.css":"53b5a7d8493c0c79eae55bf4f7e33f10265b5f44f966440e115a6a0d84609624","app/styles/protocol.css":"a2d5aa3974e7d926af8d2c4d7c8bb3a57d2ef0004e4df750514b5b19cea2e0eb","app/styles/push.css":"1f7d7dd06401de46411521ba117b44e7aecc6ff460af045af7a49737118f6af6","app/styles/quote.css":"c49e48a9208774aa2aa02cbe01b33ee78ed75a2072db7c979a183534015bc2a8","app/styles/quotes.css":"176335f640a4efdf27df6a6846a0f9aa93b8f8e26aeddc4a002d2ab0735a5267","app/styles/scripts-view.css":"da3b7ebd40571c44fdd4d2ba93d708f4c960d1dc98ccb3d03550f85f2ee10e81","app/styles/scripts.css":"5d93baf1c471b91385c41511d5eca932a0c7150dd4b93b8250f482bf791d3665","app/styles/shell.css":"bfc4bc153d8015bf2ef8a5c8c1650165cf00c5197ca339db18fa0f03d7758db8","app/styles/staff-tasks.css":"01a7141056aeae7d68be5236129a76a14b61cf7cf7860efe971cd97515242ce6","app/styles/status-card.css":"3d2f386b2f7e885afd8e1dccf64c7faa944eb4abe7699226ca2c24cff6fbe782","app/styles/status.css":"84e895d17730bc44f19111add793153baf7b47b6adc8a872cac334317da5a79a","app/styles/team.css":"39bf8fd957104152e25ae0c2d5e2d5c57f723a97356aabbfa5b621f94c58ea68","app/styles/tokens.css":"aed87f86b6d9b3d5df647429db28eba13a87c968baa11e7ec3781c0ef2879e4d","app/styles/tracking.css":"6f9b90adb52a11f5d4d1c269b5a065ae2a99d8f7903f3a9b8f1a5a310b32e818","app/styles/whatsapp.css":"043d77cee016735843592a04cec50b16d8bac6fd8fc61f99f7539fd216032a5b","app/styles/year.css":"fbe8ef429c761643a9d10380d9fb99f9b7611438d6f7ebc28d2531fc47768324","app/supa.js":"f1f88d51a3b0224116f8c2759f34bccda5fabefb5a82f82db9194d1a3675f1dc","app/surveys.js":"a4d4f9cd4e2479084c2f8f7ca24722eed3cf3f5372a0fcc9b8b7b5cd5ddd143a","app/team-rules.js":"976ab335e5011243038571594f6503e9603fe3f5e6c506691535b061f5e41eb3","app/team.js":"6f0fb2fec637780f407b71605031267058257f5587342e02792f9d1375c8ba4a","app/tracking-logic.js":"26e054585eabeb725fdb8a388084a5b08b8a1dfadb8edd13f6605705594b22f2","app/tracking-shoots-logic.js":"c4183278b26060456bea891eb42e0a1ea6a23a9dbc3b2291c9b2a3226b6fc9eb","app/tracking-shoots.js":"54e889a5aa72fad9aa249f3a7fbee5a6bcac73382bf4f36279ffc971c8d6d222","app/tracking-tasks-logic.js":"07c9170b14a35c566b549afabb5dfcc076c2a7c8ee865884c8e9177c76fc797f","app/tracking-tasks.js":"ec836f7c20b073b9136172871f8f53a37d5e6837696fd90d1fb0ab9f4b182da5","app/tracking.js":"1cf17be905492e947565db599042abd5c8dfa6dde816b5640b6f85e0e1ee9a3b","app/turns.js":"ae392c891673fab2cdb38b39bced06725c99158d8e0bcd74e88b4935086f4748","app/tz.js":"ee0f143edf0a63b7ea240f3e83e53bbda2db1501a4e992dee63788fd0ec7fd32","app/unsigned-logic.js":"df93482de0687f3feed5069634593781f8cc93edc4cc73886b7a5d1810877a0e","app/upload.js":"5e851d69cc1f253be0c2533ded69efa517add9ef0323bbae9b47b677a4ea6c77","app/vault-code-team.js":"8e86d0950a13a4de6b893a6d47a8ba083a69c3c8a0500978bcd43a2f5c51a683","app/vault-code.js":"185a9610edde21c5402949f1ca3a9adc3b93495f7673dec38e7ad3cbfe9ca30a","app/vault-gate.js":"d7bd533353ac0d03875d4ba7967a5282935ad6e2df6b27372fd207a46a628f03","app/vendor/supabase.js":"649e46c496fae692ad4fc75ee1a9da5315f79029267cd4df847e7de192cacf77","app/visit.js":"224dc4a0e69dae6d1a4b03038509b09a68ca426961f7d7902fb31c394e75ed34","app/wa-logic.js":"cb975b350df903b57213f75f81582a85f9566ffa3dcc8cc2927b43b27c5ea62e","app/wa-team.js":"1d42baa7e2258f3f00c87a644afb73e11d3f9364b1197c93d8e1b771e76a6d02","app/wa-templates.js":"77d5cd7b2c2c7009cf6bda1f53efe4da2b18b83832f6ced40ee2b930ca155077","app/week-chart.js":"2399112320f3aa5c48a2a45ceb2d9de8c1e0ffa3163f7d75103b44d3b528cd36","app/whatsapp.js":"ba1b1a9ac99a8fca7f90457f95475a3b48a5e0d9fb93bf372ec2422c3a489d20","app/work-history-data.js":"bea62e479e05717ee3411bd3f099fa040868982093399eb719b5ccb309fc3da7","app/work-history-logic.js":"d10b20bb88741a1510653b4e1f4baf53b51be1bdf69fd9dc042b7f8a24035f61","app/year-data.js":"a8c652ced94694b9794c3c71e27de06853e2422eb5d4dbef80249c0171125c74","app/year-logic.js":"4c2d7c7e32897837391d6a499eea264fbb8762e5aa0eb5e9697137d7c35313f4","app/year-rules.js":"7b2a7201d32ba774ec5b5f6b15ec730e257bcf3f33ea0b13d29c26951439e87c","app/year.js":"8d3daa9479bf8f6794c061014642e7818accd24ead23f1e4f8ec1da3694cac87","ask.html":"9b750a2af97d79df8444f98fbaf942df52e4b9c8c4f9a4de9856077b2c6212de","calendar.html":"45706824b56b19a7f33389be5784375583b1719fc04f348a219b0f614f3fd99f","client.html":"950f13a1cc56dfb492f1cb932f5c15bcbb0179d20ac36d2481123e47a17ddb48","clients.html":"14d63aa9aeae6afb7f4629d8230426e7721a52d4fb1c18d661e2f7c48443c038","clients.webmanifest":"26db9e715f603aa852bbfc7d347786b46a93148b00f53152612eece21025655a","deal.html":"8581dab3bc2510c1a3b582685ce1c002ea4b73d0af280205dbc49eade7a2519d","decisions.html":"1bbcceeacc7b251687edd25ccb34f81f9033cf16fe8359dc0b7949b85ba66d2d","editor.html":"85ef6fdff431e7acf7fdc28889fb2245bbbef3a10e56b01f4520b888f01953f4","gallery.html":"cbbd736abf1a121e2c9a29f5edc5938d8ce451666a750a5ef4e22beb8b202356","gantt.html":"5d6cce0258da82610450f2a30d6c9fa30349dee19218fe6d045efe04f0c3493a","index.html":"60399851b796993a0c9245445ab3c7948b92df4e6649c7f5797628c39fc11b96","insights.html":"cfa5a5870e50af01a965acc07bd5ae0e3e23c859b83b5b9e5ac644eb5a239c52","intake-link.html":"89537aaa9276429d1b847b94d18882ef322c02210d4db9d6bafcf23fd91d3e0d","intake.html":"6415a11f07aa10b0b65d2e96565359bd565d1c823f4f477edaaa4acb6becb72b","landing.html":"60746d1c96b6cb32df2a286e7e2819f434e896f97c819da6094fa32bcb13ca84","legacy-contract.html":"2fa57fd48db05a17da7e1c1c96c5278c9d55c17c92e9207f924136c9370e4ca3","mcp-consent.html":"128bafa3f6c4e30b6d6c0515749381a1e3d7984b341b3aac9a67595734698e84","messages.html":"32eb2a3027fe3ee7a1df008eb92034f79104ddc800799a9d7da40e1c5f0c3106","owner.html":"0a5342c98b2eeee3f92bd426fb3f9bdff1ccea12bc03673d7ff7d1482bbd5af6","pass.html":"56e23e306a1ffc4628fdef32c5ef1816f601bf7bac53b14476760e95200d4a83","payouts/icons/apple-touch-icon.png":"92be9723bfd93667664b9b95faad98814797f4234abfc18019ee86913a379b4a","payouts/icons/icon-192.png":"5a91a352273691a55273d1a4c18461de1d259b63c409e711348fefe59d1378b8","payouts/icons/icon-512.png":"56a1b7ae11292a27300ff62fcf5882d4b617f756176bf1d42423275386c3dd8d","payouts/icons/icon-maskable-512.png":"63e86d4264628005c7cbd01c7af0f5e61dcc76a1a3822f37a5785d3a9a2ceb8f","payouts/index.html":"ea2dc01ad9468ce7639c25f6199b89f55623d1bee253e4e8f2ef196c375788ad","payouts/manifest.webmanifest":"826378c942f268ca87f6208bca8cbc8d73c8d578c62af9db3a4bab6522dc4855","prep.html":"17345326a013d5720459aa9acffa702b560da819c4c26b7d322448b60e47620a","q.html":"a7e8af3c72565e4246c6f5901edef79de861bfe0d621baf291527be0ad0718c6","qa.html":"98e18caf13003bd43724f1815ad3ba3f87fcfbecd211ad2879411ed311782377","quotes.html":"0c5d8c09e98e98900635c2c1417d444b33ad7423ea61efb570a8770fb7dc4466","scripts-view.html":"ab940932d1dd62061414eebfc330131b932b10195bab9414e391999071f45c93","scripts.html":"64b7ba08db01c0bfd7a8002aefec64e30c9e146c232b011d7aaea90d52555eb9","shoot.html":"08cbf8fba5841863eebd0e38beaccd479bcd270608f1fd9201ab51b46771a5b9","staff-privacy.html":"452bf5e48ccec9f396a7090fdf763d5fd402e1f90c9decc87be3d375aab79a4f","status.html":"d3049258960416e2eca471398f63dbb74bd7aa12ddc2b2090359d89521c2b3c6","team.html":"b0c73bf6c3d77c468b1725512ba3645979bf4200720663df3e5318ed0f9d1736","tracking.html":"c38560e6875b934d7082a5ed27c3498be588a11d69705825a8c8d83a5bc82d57","year.html":"3a8147ac0d989d0cca090a2c4005d32083915c1761305c26f58b0442225fc1ad"}};
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
