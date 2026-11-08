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
const BUILD = {"version":"b028831ee4b3613b","files":{"access.html":"925bade00174f5809b79c1bcbb874be2bc0eda5b3911c25b38fa4ffa20e89444","app/access-check-ui.js":"da48d8533a5b50511e9b7e1c7113bf790e0791ed094f455448577c4835a925cc","app/access-check.js":"1e24443baf7c300f643b5bbbccbbf971fe5c618ad9d2fb54c8c1fd0c1d928988","app/access-data.js":"81b0491e6d733b5525edc5437b7f7f180ccf684a13f760033abcb6c3a9ea64ef","app/access-form.js":"a76b118001574aaf62610ae7cc86764aef2b17c207cb9a181e98f42217b73248","app/access-link-ui.js":"8710222a349bfed486b9cd675f7588ae0fd9653e61318e48d5d8121efdf2cf85","app/access-logic.js":"c3b2599edf933c6baa8296e0e8641c4b7eec55dbe1a7960893afab8de15ee147","app/access-nudge.js":"1591ad693817b357068ce891bcead9fa043175c2f95868487b1b0a584d4b3f1a","app/approvals-logic.js":"0e8cda55a06731c8d197f576def80597460a1e00bf7ff74e5709636cb2dbb6ab","app/approvals-ui.js":"c5ce3b45c573b7bc1afe9c65ccfa7dea9fdb20c5c9bc481e97580e5de175e39a","app/ask-guide.js":"bf87d4b55a336a34d76c91069c1ea0ba4e014783cc342dc3fe7b0187d4d602c9","app/ask-logic.js":"259d7b9e5a8d00cc806b31ce9c62fd18887b77b1e96ee552508dce6f09bb6ee2","app/ask-page.js":"3db2869e75e1196bf4db51cd43fc939c8e34367325ba00758068b29ce57580f4","app/assets/logo-mark.png":"2cd2f349d456cb9b3ec6296cd9f069f1ffe65d1bcacceff8c878067d812954a4","app/assets/logo.png":"f3449f67c8e000b64f4b70e4e1f4d416b3461f5bac4b3c8bc4bfd281cff826c3","app/assign-dialog.js":"f0401e29b241bda1a8415ce6aa591d8e8fc732b545bce510f9bcd948ddc5a69f","app/auto-assign.js":"4f81af99bd039c217a7a348022fdb045595deeeb3321dc8b2c41625e17340ee1","app/availability-logic.js":"1910784d3341b6cf7ccff10fdec8af8b99c8e9d60fd96b7a4a265fb7bfb42bee","app/availability-ui.js":"c224489aff62d4378a3c15737e99c27492171c278220da563b0941dfeccfa844","app/briefs.js":"84d702fcfa7640ef1152dba3009a3720e0bc89c888ef5f9d30648b6803a44c88","app/builder.js":"b2af021e70fcdb2f157122039acf504d7fcadbd0d5a31519a96a8b44db7abfab","app/calendar-card.js":"df0915780ec8d93fb45735960f270adefc5ee165bc0e7365824a2f750b650344","app/calendar-feed.js":"c9dcb1a6b946059b065b888387a2092c76aef2a95a8ee9b7e813225d0467a21d","app/calendar-page.js":"5d6c4f17027cf7512e83ef269ca406e5d49f0fcfe62a0e0c2d285f20cf386d84","app/calendar-view.js":"639c3ef2b740c3b92fb63b9c7f60a7c2944ef482d0e19cc1b611546fc17d8552","app/calendar.js":"a3d90813076a9bbada79b19b1a58d1ceea3db780778c274edd967d48335a6756","app/card-assign-logic.js":"209c0aa7c4c915c0bece20ca6ed4f134519fe8c4545392357733ddf11f8beac3","app/card-metricool.js":"12eb4572d2ef53de67a5552eeba6b5aedffcccc4d00427679c352b790c2049ff","app/catalog.js":"540cd772c9efb1858a1dadb1504091750763c641c6f69d76dce9b0c20a58bf05","app/char-doc.js":"9c90d23555e1288b5d11dc66b7148852fa04636e45fef52fa894f2bc583aad77","app/characterization.js":"0db889ea0a70501b4e1a6f1922fe5f9d1d24c33a96a72912a399dcf765c97630","app/client-card.js":"0a7de37c40b6daed4bd9dcf0be1250195520b889ad9fc15ed983d9e9be604fa0","app/client-contact.js":"4b2a455fbeb79fc3b85938e8fbfc1dc8bcde3997cacdc4fbeb477d7232dfce7f","app/client-links.js":"3b0b9d9f37fcde761e125f8789ae5a685da13e477b16863528f59481608ae035","app/client-open.js":"d4fcf4ed288a80ad58b48748b8133bbf120df05e4568ff95a6d8840e718dc93d","app/client-search.js":"7b2441f9d5b963a0da4b619ac954481cc23218f559ba6ccb17dc9a1c3cc875d9","app/client-waits.js":"26e40be97dd7fae399b3d4457f05da772f1ec42ccacd966ddbb8bdba0c91ebf7","app/client.js":"4a46735b73393cfa00a93cd83546068b94ad444019c97bd650a49ac2d5644cc1","app/clients.js":"6bf9480521a7da470221ee01e03be203b5b0f0b2c22e140f77f94f6fac01680c","app/clocks.js":"015f79f6d3e8e1b69548b4875419c172e8b74e0af19a6b8d9223c46710ba11df","app/contract-ai-logic.js":"14af2682ef1bae1462ab692b3f93281ec2ebd50a849f5c27622c1b32b83f2a19","app/contract-end-ui.js":"d98df7952bae2974b3f93d4e8558699533a66bef04c6319f06c7b9210a3ebc37","app/contract-end.js":"b66cecd558d1d652468a99a3c95a2845e02fca302ff636921fea1bac165ac10b","app/contract-file.js":"9fd883b9780ce1bae4bb4257c652f0a1678f6c840a7d96cd20ca8d697bc82032","app/contract-read-logic.js":"95e463e00b6cb951e0106161da2facff5e0f9f0366f29dd547b4ad96da4d3617","app/contract-read-ui.js":"710df722e1d3c64b12d55f6c598722c88826d6de14c780fc6d53b4cad55ab6ba","app/contract-summary.js":"07b55424ff9bb34b0340a2478178249fd20443129d1af02114874ebb0c8fe18f","app/control-topics.js":"ed22cb40a8912aa68e57180667fe96afca4b2b94612876586643dbd94fa0c8fe","app/dashboard.js":"124b9ddea4c7130d363040a4f05786bb862550b0da6faf966ac9454d2894a08d","app/data-cache.js":"244a22e145366982393d98b9e0dcc4a8e09b4afe2118a370a7f46c6abdacb2f3","app/date-set.js":"b561500cdbbda9e8bc38ca99aa35ce0c6b9eeaee9ddef73b6d64d9c10cdec798","app/day-summary.js":"c453d64b30efe64f803edd003bf0b81affdb34277a220a502f8b7f549b299c6a","app/deal-data.js":"6ce544fa820e66c78491152729995a4582497f56c87e651a8762398dceb34ed8","app/deal-logic.js":"21c6bff415fb0d1c3242e550b10a5e76c378d15b3a96711fba52bf507fba16c0","app/deal-ui.js":"2c78438e9c26fe7e8ca76c3fe73c608d5fbbc58a2d7ad639d8a0fbaab11dc5b3","app/deal.js":"568d5f597e937f1cf66ac63e82bd69b4ff4f51453414491e4fe7659939f1c919","app/decisions-logic.js":"bb62314cd87808dba544a9d454bb56465dbe062ccc5b08b34e3ae5a6e0992626","app/decisions.js":"2babc244880ccd86a855b8408b66fd05e222a551459b97a921dbddedff4ca085","app/drive-links.js":"d7d90b17a5d280089e7ff55abeab65f844c12e773110e72e66a5441f593f1a35","app/edit-count.js":"088c6208d11e760184097bfab292c90d48de9e340cd47b0dfe22830eb75e1e1a","app/editor-order.js":"b5088166bc31046bf6ff63494b874a261b8765b4c6d85e4b7cbdc2de3ba1ffbe","app/editor.js":"bc636e6d290264936d69f6ef1c341351667561d4d2fe429bc22ad30bf5a762cf","app/fast-ladder.js":"1e03546c76a9a35acf235bae665431db553de4fd4623a6528f9a7849e6967938","app/feel.js":"59e125c5ec2091ad8745c03d9483be37d259eaf865a897218b02da546c9534da","app/files-logic.js":"d853faa7d839180cf4eaade06e1287af3ef29c8274315280f18bb0a853a16671","app/files-ui.js":"d243aaaf2654b278046773fa164dc250a0b717af38dbd617fdccda28a850448d","app/fix-request-ui.js":"237abeb2bfe053807e3ba66285184dcc667792c67961fa1c8f2de78a329a090c","app/fix-request.js":"f949d7353fb9b739491334a8390da73431437fdd607cf10be48570437ac3a970","app/fonts/OFL.txt":"5163e9f9fda30f27c95700c375293baaf841afc890d8a8496113bc954a19ab7f","app/fonts/fonts.css":"84aa1405bf6ad2b9254f23e2afbe389d852308c8c4d8305fa97e9be4d28e2236","app/fonts/heebo-hebrew.woff2":"f1f7cfaef59431c7b391df81fb05520273303840bbe917213a2ab9f41b839675","app/fonts/heebo-latin.woff2":"50dae2e12dae22c920388023e35aaebcd1e1d27bbe915c83d64210377e083e60","app/fonts/jetbrains-mono-latin.woff2":"18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e","app/fonts/rubik-hebrew.woff2":"197b6dbe5c6bec7276c59b02d70a16ee6acd44322fc2f8d0226c07f8d57976c2","app/fonts/rubik-latin.woff2":"691cd1d9b4c0cdf31a1dcf04259c86f92c85e69f6622abab7964d81e36890691","app/fonts/varela-round-hebrew.woff2":"61f49780c3763145a924f538636d2e4aa190d614ea44a190758260896e4d804d","app/fonts/varela-round-latin.woff2":"03871f86c86fc776f89d0cb947502f3957181b63327fecaec724bc39d082319f","app/frame-guard.js":"b6e68dfdeab0aefbd99ae86d6138a4a99fc3e23eefba5cffd373732718a063c9","app/gallery.js":"a1f6ac4cc72ac8abc5a5aa51c7b7e91410a62fee337c535219c200ef98111476","app/gantt-brand.js":"fc1feca683270973a018306fb84d322ecdf28931eab2ef5d1f91bbc1dd11bce9","app/gantt-data.js":"8bed740098566afd9564fbabecba9f580a72f192180539f94f5ef6bacf57fdf2","app/gantt-drive.js":"40d1c6f2dfdd7a63c32466ed5a9589106e730abb0fb82fe8396bad68f6092a31","app/gantt-index.js":"0e09b7ba902bbc23c92ec59a3ddbaa0af62015f9e92a0aede3a258134ad617c8","app/gantt-logic.js":"a4487c1ca788b602f77834e31d225a3e449a1891b08c958f8bfca39652f6f1a8","app/gantt-template.js":"d64560bce00d1a4de816b99f839f07d6e7c9108ea77218ff5240a41a51d1eeed","app/gantt.js":"f5fef5035611488f8c2222e4241b11bdb02e12ba462c7ff648a44e895c106ee6","app/gcal-logic.js":"2cdd440d7e0dc93f0671881b5cbc93ee47d92334faf842a1600e7f503fea77d5","app/gcal-page.js":"7dd28e9657536f98e9e601bf1eb17cc5106f7216901835b9590a670a876b3db6","app/handoff-ui.js":"f7af5179d0ed29b8deb8c1778bf05d27babb1ce2cbee77077afc395f4224a09f","app/handoffs.js":"bac9bf7f8e3e9d2a215fadf61a445e640d09d9e051e3eaecd7fa6a89e23157d9","app/health-ui.js":"114b88330f76f0d8d2ef6dd949428129dd069a6801ae84e07fb4578437428177","app/health.js":"fe228d76197c2a1f80ed6e09a3089b1f91d863c46c6ec81997168579c3b7679d","app/holidays.js":"abf016950aad8ec6044f8b59e21bf1865acb6c6cbffd5bfe38e8101935d75592","app/ics.js":"7dbc44707f531580f05eef0e5351e924c09e6f14b8488bc855b8d619f33d7c8f","app/ilai-card.js":"22ace26db50c69e6b3dc61db6201465231bc2dc69b1e561160cce500808bba7b","app/ilai-logic.js":"02e8b9b1210ac36cfe180e3b57bd025cf49db5bd85095c3dd2c1f23f4ba37148","app/insights-page.js":"35dd2b403fba97a2e9860a9411b67493311240f6f123af3a9fc5500435a4cd5c","app/insights.js":"f5f52be9b275d7d976120d56b86967407d94f9e6992a20cda5b5debc23047ffe","app/intake-data.js":"77da50026e126f8c0fc46e874b57ce516fb99c32b2ea976751cfaa4fe3edb3cf","app/intake-ui.js":"a3463a8abb1eb525ae087b2d8f0cf88a8ac48a110500447da926be0e258a6b7a","app/intake.js":"34cd383e755c2046108cf3a5699cc094425e195cd4fc837792151cf81e373647","app/kit.js":"f23a96f50d5c335b118b360a49e994686bc88711391e59791d0f7e07d9909681","app/landing-control.js":"d0f8b07d3fd31b251d4ddb3aea6a35e8c9f3870fb09541bea8c6f1bd7785c196","app/landing-data.js":"03afd7efc0d1c60da64a839fc93ab0ff2620938ff688ee4b5d49c4d88817076f","app/landing-link.js":"b3c35c84126c0a695aae027728057a8b6ebdc1193eeb69771418d1528a55cd47","app/landing-logic.js":"9481e98c75600aab0048b47de1446d8e299fcb6958438a3ea6cda79e04d5f2d1","app/landing-ui.js":"7b039fb6188f415220f250c29df757291c04f337c12aedb2c3ed12733bf48751","app/late-chain.js":"0dad81bac7c804bd9f43f3749220b60d3f11acf3a8333d7a11163a9081a460b3","app/legacy-char-data.js":"04fa38b8e3521cbb8995673ecf4d1d822c6bbfcadeba4880cb7e5a4775205ba8","app/legacy-char-logic.js":"dd30f42233d8d458b83253828c8c5b73b02a7c80c5a187467cd4552015106a0f","app/legacy-char-ui.js":"fae67fab1ecec0d0e53012867c014eacabe1e38476870c529f8e91059f088c18","app/legacy-contract-full.js":"d3f3e8ccabc9085a6eea4e6df4cd12b76eaa0fffb78842587078fdb080309fa4","app/legacy-contract-logic.js":"8130d09795727d8650b23d9e76ae261bf940b3d28720357db0ac1b9c1c8c95e9","app/legacy-contract.js":"2b963f0b48ad4fe7ff675a4c0beb81297707e2aa717df199e07e3e0e904b1b6a","app/legacy-contracts-data.js":"56fb1bb66e7fe51f13fa8eeffa2382194b8f8f6f9ce2aa57acb724b284fc26fe","app/legal.js":"b3137ee240a181bc406be872034f5eae707c6846b745db877e29f798260bf62e","app/link-token.js":"4c7071749b1b38c57d7915fa3dc1f2f887080f74a9ffeb5f7b50076b5bf6aa62","app/lior-four-ui.js":"1540b8d29d415a1c039a2bcd638c012c72df10ce3896093ad0520488f8caca42","app/lior-four.js":"796d1000643d3bf6601650b95b79f39a4317c6dd327c40baa17d4d5e8efad504","app/log-brief.js":"c29e74e90867ba2e00d175e71ecd5d4da3d1fc92beb0560dc4f59bfe1d0a0802","app/login-gate.js":"a6ebfb294aad632130bf467d6a8818c653e156ddd185eebde6ec7041dffb730c","app/login-ui.js":"b8f309f41bd2bf79907903ac152e281ce93cfc340fe9d1f70ec3a2e2ef0916a3","app/manager-data.js":"85597fd7742480743c6e82fee52684968d53197b69821fa41ef8f2fcbf2c0147","app/manager-rules.js":"9916a44e43d97e4783a9960f5c7dcb6ebf79b57fa9172816800d046b2b28aefa","app/manager-table.js":"cb751bb655e165d9e6d8c996a49006fbb9e223ee5540dedc72dc464f26906dc4","app/mark-guards.js":"f1bd59d1c9b421e1a3da3ed08b1b3c69ed71ba98cc7267899168bdf844879dc1","app/mcp-consent.js":"4aaab030522f11c9e8dc27c85ee8ffa9d106d245d4cf7cbc539fadb6925765dc","app/mcp-draft.js":"1d752dfa71ddacc2977d0bd09fe4477fa0fe87a6901bfaa5a935928334e99e44","app/mcp-logic.js":"d2655443899f8e9002fb1507fa36c1149586335ab4de7eed8e7808aa258f3ba2","app/mcp-team.js":"27559d2c4285e2d5b70b6ab989697d0178a9a209bf25fcbb3f275e2b8a51b726","app/messages-logic.js":"6401ab9d8a5ce35757632fe2dfcde8d25afcd7f9eb269332f55967ba52522d12","app/messages.js":"e2ba999a9b0969d7a5d6cdb72c43877fb4667917ed484712df36fe880d21c60f","app/metricool-connect-logic.js":"3c2aefa93676638ac26dec2da62ddfca8d783afa3acdae62170c5c8b1716a8b3","app/metricool-connect-ui.js":"017687954c5fcd42be7005e6c144e1f822d4e920d1f852b7a6153fe159058560","app/metricool-logic.js":"ff25c2c09a1857f9698a55b560272fdf66fa12770ca5ca9486a9031e2b6a4d50","app/metricool-team.js":"976c84ccb7087ee84c61fae2fc146c075c0c525cd2957bcac83ca5252719f2e4","app/mine-connect.js":"6c26da0ea8d25b13f8cf1a79418b50558541ddee6adca7c404cfb066b70452cd","app/mine-flow-data.js":"b3d4782660a54d68d4219e7f53acebfc7d7dbbc0103765ad988ff02a971cd16c","app/mine-flow.js":"cf71a14043c54b7aa66eea37dcae087476b7f22f61ed180e1a040ed2d759c1a8","app/mine-metricool.js":"3c306431850994e230ea2215984eea601834d69eeb95cf693629e6d566010748","app/month-ui.js":"3b3c8c2238088ecb6e8732444853943f3d9a6e4a4750723e8f26766c9e1cbb10","app/monthly-rounds.js":"cf00a50542b077a202a647ae5ba73210f1a21e2d357d265371fae6cef94cdc80","app/monthly-shoot.js":"c8d4bfacf19956abdd732e9475656b1617509100c34d86efd95665def70e31d3","app/new-meeting-logic.js":"a56d1fa0aea7e7a3b8d9243f8fcc1126522577c8a51dbcbdcc2b24d2588f6ddb","app/new-meeting.js":"7d273b4bfc8db7730d75d1f3b1f80068d66bcdccbffd233bc46b1309bb75f6bf","app/now-bar.js":"f2f8b0cb4ca25e9fe2117986c9849f82cdde4f16b3c807eed3e183a083336e1f","app/office-data.js":"154b2cfbd2e87e450176267bca6abcb788d412677c865f1be3175ab2a926a839","app/office-marks.js":"b7f530c25d78b3e8e486e721082089c8fa56a307d39836c01569bcd8812c8edd","app/office-ui.js":"588356415a1025aa85c52849324b32db3dac9896d88afdf06670e59cd24365e4","app/owner-data.js":"0348c0d304511a8ed3b2c2ab761e8fbf2ef81a079084f21b619409b2c1c60fa0","app/owner.js":"8d0e7eb837dd834d92c5c04e65cb564ad5c901317d3fe56f870a024930918cdc","app/pass-logic.js":"5a71537381dc86680d8e9ef079165a952adfd85d6a24d9ddbe169e3ade2c6416","app/pass.js":"27e33550d539bcfb5bf3547b4ee61b9c702c27fdbc1bd4de9dbdf7609d8853c9","app/payouts/app.js":"54ccd8ed9b1d10084ffe5b23644ee555b592f586a8a3ddd05b8bdc1d0912d8ac","app/payouts/client.js":"0931a4786e8a712694137ceb2b6031366818ae6d4efb64768b4217d355b20ed5","app/payouts/data.js":"0a7767abdd3eed3772571679b435ce4b827c451b66fa5e30c1ebc24343e7b6fd","app/payouts/door.js":"532ea19714e99897c7eb57fcd1a181932e05d89496f482cf6be0c846ca8ec03e","app/payouts/engine.js":"831e3f89ff5db0e9fe5c606ba96abf4cf9dfdf1aad536040a4100fadc9f7bd2a","app/payouts/gate.js":"5409be7ed9a7d3d6147066a0ef0ae3a12dc7a91831207830f79be140ea53d5de","app/prep.js":"2f0d5fa28378ade5ff2769cbc7cb6377488481944ad5707d409bff99575fbc98","app/pricing.js":"30dbeb50302d87187ce91656d2b7b51b0c0f6fc78014b7f65decaedb25208d2c","app/production-data.js":"9a90da9be46004762dd4b270da162dac4e7a97a1d39ee98e44814314d133d70c","app/production.js":"b68d4fe1673a3af086114627f57d436f22ecdcfac2434be531d4a7e35e09ff08","app/protocol-data.js":"a81a20eb241282c1340a5a6be113ac3e19f03a378a93a4d1d8fd64f47aa00852","app/protocol-logic.js":"3270822aa4992257bdf72d2ae7ad110be076238e1fe9e571809b729452f71dbf","app/protocol-ui.js":"9c00a1569117d3903b126e8a4f03138b658cb6b1d1395ed96e90ee406ce7f40a","app/protocol-versions.js":"f7701e626d632e74a5f4eb20f57bbe237c6d8e60ecd2cfe9b62f709feac3f9b1","app/protocol.js":"9c730b3ec89de2f415fc3f4d478d23f2c9316561fa3fb24ad90fe45975fd5f34","app/push-config.js":"b8fbb7f69ec84dea60a1bcdb43a59dfa69ce61e389b61c600214b53ae78f4d55","app/push-logic.js":"074ed6ec25a3412ca03387d8b030206d31d54febaf134aa2c82651c7ac9234fb","app/push.js":"888f2c6855037a844979b5d38ea8ce281040abd72d2ecaf01782dfe794b7bd27","app/qa-logic.js":"f4e3197ae9dc3f017f3f51a2756e80cb499695072c75e88db75dfc6388a85340","app/qa.js":"c244221f3d7ddd944fe841c4c3600783d34b2b68fa84e40aa2b20b3fa661b946","app/questions-ui.js":"2b72df41eb8da6a91250932eebc7a7afdaba480d2952a12f6be5240f15842be6","app/quote-doc.js":"3029c38399bb07c385485486881399fbcda273dbfdc4b2dc22c3ead11aeee7d7","app/reminder-engine.js":"9247aa65afffc37c71a250dbbed00c2821350650cf555cb2f2f024db2e2c90b9","app/reminder-rules.js":"358d148264e0a78c20100eb6cad3fc9d459cc115ad09f92be39d7cf0dea8db0f","app/renewals.js":"d2bda706f4b349703660bf079ade8ae78441c7c84d4647ce7924676a57563d1e","app/scripts-data.js":"3f1ee05eb7eb630f0371273b581064c4470b01b70816b5d037b4b2ffceeecab8","app/scripts-logic.js":"e7a56a59654c9ee049a92ca0398c875708a4f68aaa74755e0a78d9fe12383a4f","app/scripts-view.js":"71fc4e1f78ed92fa290ab16f1b2fdfcd55ac68897b31344a26e7a46273db8052","app/scripts.js":"ff35c9a19d1834b4425b85bae7bc158ea795ceff884b9b7794400266e04d926a","app/session-store.js":"8367a1e114a3acad37f2fb259b7a371bd98785e359eebb54c4c492dc9b5f836c","app/set-password.js":"6c8ec25c4dd1ce3acf67984e175f2b2e18a16de1f9164adf85513a78317a0747","app/shell-gate.js":"55fc49602d0f14cc45be95e879903f0393d52a87830c4157bf4415cdfd7be46d","app/shell-rules.js":"778ca496ea20c12f0a1e1c5eecb458b6844bdd1a219ea0c91e09934be6ab7f58","app/shell-state.js":"88d5fe6d67669c341ec8c507b7f61296ba01c0b6648152bd41f63cb871faac5c","app/shell.js":"19acc78a87cf5b0f0542d78116bb5e5f7f0a354fea709ec84893e60b3088c123","app/shoot-crew.js":"43fd099136600c3097438a7585df7ed393c27c3258683a10f4ff776c0699729c","app/shoot-plan.js":"bf40bb7c0592763d0f6c69a3b29d800c1490245bbe4934b148eee7e5d3736ceb","app/shoot-prep.js":"053620acda7d218b4107af632ea55c76d5da9e7114330a9971c57fc0e348c113","app/shoot-table.js":"4e711c3518411af5f6bf88cc6fb2812a0b3465ec413a532a065d69754a6565aa","app/shoot.js":"9461fe56936ed5335002125fc33f0eb53891d9860d85143c4aa9363ae9055c49","app/staff-tasks-logic.js":"d08f5b1a9de1e70598910e09316a0f2e0ae3379d5bb4ed3259e3b91917b756c2","app/staff-tasks-ui.js":"f48c51c81e32adfc7908b8a0134450fef61e24f8ae6455f3f55805733687e9ff","app/status-link-ui.js":"bb2f2108f3e27c2131f0aaa566a40c4d8f31422121ba395e28bdedb1798682d6","app/status-logic.js":"d0fd5e0ae365b33a6ed29e2f7270f46c35f1115958f06f1264a46129bbddc06d","app/status-rules.js":"dfdb5f1b56427daddc776827088a24b109ef4cc3357375c28726be0c9ae2fbc5","app/status.js":"2f279845c0316b59416bc3baa544a6d61af1036958868b91ed69c3777e9b0023","app/styles/access.css":"3562d531d946a6f206e58aeaca838213fe52e345c99935675e1f381b001deab6","app/styles/app.css":"76f4369811f93d90878bb139313788945d629dd0124c8a8b533f1e61ae73a4e3","app/styles/approvals.css":"109ebfa9a38a1313e4ffde0a4f28bfa8a80367c8833f840f68a7b4f1ad636b66","app/styles/ask.css":"b20769327be92b64f01c11d30886ae189e1fe1c28530a0742f319354e22f7230","app/styles/availability.css":"3eecd9efa885ce9525a343bfd1bf2a551653387c4926cc3d3c5510167d616736","app/styles/calendar-page.css":"c8d03fe5c62bb927c0385284d385ea82741a0fb6c88dfa04060d4ac8c7996d24","app/styles/calendar.css":"35b5240dfffb5d17b57aba3ea31368ec1dbeef97908782c3d75884cb14c68e93","app/styles/client-card.css":"7df59104a8749f8e18dd3f460151dadb39daeac89e017dd8913bb11a8d823a55","app/styles/client.css":"738c74dd9b66df69264ea22b5309e800fa58ee20739bd139845a8d7bbbd5f7e5","app/styles/deal.css":"14c834092fb6c9989033094e8f130e16023a68b827201a53f630ba8165516f38","app/styles/files.css":"60c84c02e30903b6b3505ec9c9a83bda20b4658d6756ee22bf322d93f1e781c3","app/styles/gallery.css":"119febf95008237ac6fed746aaaf235f4e6ca09b13e17c1dd9f9366298f0d126","app/styles/gantt.css":"b3dc1f85c76cb99cf9c608903087db70a23776962b0f836cd6a01aecb03914cd","app/styles/gcal.css":"d1b71b20244bb1ec2cb617328f75062b0103013e21b32361cc916832936737a0","app/styles/insights.css":"a2c72392f0ce707861c9b0d852a1b9d00414f764f11623d6a8d60075002aeff6","app/styles/intake.css":"78e638cba4ecd98e2e91ec51d40e91bae6f3959f227260de402ca7fda450b37d","app/styles/kit.css":"c74262bb54dc10d71390993ea4edfe699c439e92b1f67f2a3ed5a2cb28b493b5","app/styles/landing.css":"c66a09dbdd518f46786635e057ecef0c948746ce5788ebad564bd371a4079d53","app/styles/legacy-char.css":"7c980e39ac7f786b29fa8453388b7e59474b208fbad79164c54b8950d5b59647","app/styles/legacy-contract.css":"3d3943cae4ff8fa3cef0e0eb53cae9c2166aceee514237559ae909c2f21434f5","app/styles/lior-four.css":"e18ce993d9ab33acc170c886d7d47780bc2c878bf17c0d2cb1d19c961bbe4a46","app/styles/login.css":"a2e4875337a6e8c6120421485a4cdbe7b1be647ba0545822f290ba7650f930f1","app/styles/manager.css":"a88f988be4f76e0d77e0652f90a09df1d27e6eb15dbb3c7fec73efbe1e62ce0c","app/styles/mcp-consent.css":"241c86f91e66dcec89b41032347de56fa10f26193cccb1b2501c8bd542dc5758","app/styles/messages.css":"b03b368e59ea379fc578fa4627e5433b4f9db50ed8a6d63d8269657dcb7d0d84","app/styles/metricool-connect.css":"46a4b6954814f867f089807a0acd1802a34e32840a58d6dd12936428e5dcb274","app/styles/nav.css":"5082a6fd68530185c4cd82244f53c2f61ed7fe6a61bf50219b67d2a8a63d0154","app/styles/office-flows.css":"15ab64f4d83279805759df154af73c85897f0b40a1bceacade924b4a098f68da","app/styles/owner.css":"1eed9791996f9b6ed3b1c64fe3f11b35b3a7aca887431f31c1aff924d439e2f3","app/styles/payouts.css":"c813b271cbb3d3f0e8f920caa5cef065fae90a68f91e303619133653e209c3de","app/styles/production.css":"c0457838e0580a3484ad2065bbd9252047b2aa3009a4d3ea10c80f605b3b4d5f","app/styles/protocol-now.css":"7eef1b506d2474331a5f1e2022c01b472786a93a4cc85de909d9f1f98d1917d6","app/styles/protocol-office.css":"ced13afcecbb01286e89e48b5af692520a691df7ad3fdb06d46cf9f4c4d07ec8","app/styles/protocol-roles.css":"53b5a7d8493c0c79eae55bf4f7e33f10265b5f44f966440e115a6a0d84609624","app/styles/protocol.css":"a2d5aa3974e7d926af8d2c4d7c8bb3a57d2ef0004e4df750514b5b19cea2e0eb","app/styles/push.css":"1f7d7dd06401de46411521ba117b44e7aecc6ff460af045af7a49737118f6af6","app/styles/quote.css":"ec13946893e82bb8a30170627e610823ae2dae31e18bda77e70104e1d01a34a0","app/styles/quotes.css":"0d535f4f8f8305f611879430ca53722e9e6e43f6415be2444c18ad917dbfff47","app/styles/scripts-view.css":"da3b7ebd40571c44fdd4d2ba93d708f4c960d1dc98ccb3d03550f85f2ee10e81","app/styles/scripts.css":"5d93baf1c471b91385c41511d5eca932a0c7150dd4b93b8250f482bf791d3665","app/styles/shell.css":"760e4a9dafb5b42892a7b21eb2a531b68b96e22833b580b98959322f54c4a666","app/styles/staff-tasks.css":"8ac2d5fa98fcfa59bff7de59eb902875ea3dd6fb38889d2e4ef6495800792e32","app/styles/status-card.css":"3d2f386b2f7e885afd8e1dccf64c7faa944eb4abe7699226ca2c24cff6fbe782","app/styles/status.css":"84e895d17730bc44f19111add793153baf7b47b6adc8a872cac334317da5a79a","app/styles/team.css":"39bf8fd957104152e25ae0c2d5e2d5c57f723a97356aabbfa5b621f94c58ea68","app/styles/tokens.css":"aed87f86b6d9b3d5df647429db28eba13a87c968baa11e7ec3781c0ef2879e4d","app/styles/whatsapp.css":"043d77cee016735843592a04cec50b16d8bac6fd8fc61f99f7539fd216032a5b","app/styles/year.css":"fbe8ef429c761643a9d10380d9fb99f9b7611438d6f7ebc28d2531fc47768324","app/supa.js":"5c45179d314522e8d7c0fb4b6afb423a0136461ee1f8a2a8ef1ddb8db477af5a","app/surveys.js":"a4d4f9cd4e2479084c2f8f7ca24722eed3cf3f5372a0fcc9b8b7b5cd5ddd143a","app/team-rules.js":"40fcbaf2380e6d0d52b16a9fa6568d1eb888220ec2b7c01308f11c831bf4b88a","app/team.js":"6f0fb2fec637780f407b71605031267058257f5587342e02792f9d1375c8ba4a","app/turns.js":"ae392c891673fab2cdb38b39bced06725c99158d8e0bcd74e88b4935086f4748","app/tz.js":"ee0f143edf0a63b7ea240f3e83e53bbda2db1501a4e992dee63788fd0ec7fd32","app/unsigned-logic.js":"d242b641194024325b5af426f4e984e82dc5c25d6969e442139b7041379d6e31","app/upload.js":"5e851d69cc1f253be0c2533ded69efa517add9ef0323bbae9b47b677a4ea6c77","app/vault-code-team.js":"8e86d0950a13a4de6b893a6d47a8ba083a69c3c8a0500978bcd43a2f5c51a683","app/vault-code.js":"185a9610edde21c5402949f1ca3a9adc3b93495f7673dec38e7ad3cbfe9ca30a","app/vault-gate.js":"d7bd533353ac0d03875d4ba7967a5282935ad6e2df6b27372fd207a46a628f03","app/vendor/supabase.js":"649e46c496fae692ad4fc75ee1a9da5315f79029267cd4df847e7de192cacf77","app/visit.js":"224dc4a0e69dae6d1a4b03038509b09a68ca426961f7d7902fb31c394e75ed34","app/wa-logic.js":"cb975b350df903b57213f75f81582a85f9566ffa3dcc8cc2927b43b27c5ea62e","app/wa-team.js":"1d42baa7e2258f3f00c87a644afb73e11d3f9364b1197c93d8e1b771e76a6d02","app/wa-templates.js":"77d5cd7b2c2c7009cf6bda1f53efe4da2b18b83832f6ced40ee2b930ca155077","app/week-chart.js":"2399112320f3aa5c48a2a45ceb2d9de8c1e0ffa3163f7d75103b44d3b528cd36","app/whatsapp.js":"ba1b1a9ac99a8fca7f90457f95475a3b48a5e0d9fb93bf372ec2422c3a489d20","app/work-history-data.js":"bea62e479e05717ee3411bd3f099fa040868982093399eb719b5ccb309fc3da7","app/work-history-logic.js":"d10b20bb88741a1510653b4e1f4baf53b51be1bdf69fd9dc042b7f8a24035f61","app/year-data.js":"a8c652ced94694b9794c3c71e27de06853e2422eb5d4dbef80249c0171125c74","app/year-logic.js":"4c2d7c7e32897837391d6a499eea264fbb8762e5aa0eb5e9697137d7c35313f4","app/year-rules.js":"7b2a7201d32ba774ec5b5f6b15ec730e257bcf3f33ea0b13d29c26951439e87c","app/year.js":"8d3daa9479bf8f6794c061014642e7818accd24ead23f1e4f8ec1da3694cac87","ask.html":"37f2a46e51bd587d34497bc98e5199a1d1bd136461c9b730463291ff363418a1","calendar.html":"8a874b4cc786c03d606be9898c5d1f8982d33c6211f324c09501dd231867a581","client.html":"a4ad76b00c87c0430e2c05f398aeaa802eff0f35c92c23efed7507f9229d8e46","clients.html":"3a010240a662c3a8305d459b4a6536e86122d6cc0411c210ed088b8b3367f4cf","clients.webmanifest":"26db9e715f603aa852bbfc7d347786b46a93148b00f53152612eece21025655a","deal.html":"1e8de9b23afe6a99cfbbf494193dc0c2b1b66b70e1095e5ffd2e90e87519b72d","decisions.html":"a24458a0e0eeb27fd41bf581de214c639e042c60ea835c630dbf92c1acd0df76","editor.html":"1a475c30ad8473348e6a10dd442b2c8d2e9ceb0cb552f7eca338f69dcd23136e","gallery.html":"bb1f481f6c49358e357c33ad2b275e647624d8aaa58477071a051816c7b6e4ba","gantt.html":"0d13834882ef2c24d426960eb01c460078543114a6be5a8b6cdfafe6c96add88","index.html":"be20da180adff25fa969903d92c08b7c8dbd80cfc011830b1c4ceaf820c4571c","insights.html":"71b14985812162ad1939dd1e2d64c1622e047a23411c7192499a0fd3853fdcf6","intake-link.html":"a63a7987e9ffbeabfa3a79f053734605c1c1190d25fb777d22ea7054003914fa","intake.html":"1d88fd7467b2170e318750743fc2ea32ce012e1d0601be9f55a0dba63a751fd5","landing.html":"08f509c9f135ac540c0681b4eb859b9fa408c48202ac439794ef133d67c0e245","legacy-contract.html":"06aef5256567a7d3b86d7f434ab85fd0b2420d7191f55c7b2ecfa6eefd3e6cc8","mcp-consent.html":"128bafa3f6c4e30b6d6c0515749381a1e3d7984b341b3aac9a67595734698e84","messages.html":"c5b24a8cf26000cf2d23e871106b8acb0693fe9000fde13aef8011bd71eb7013","owner.html":"d3fc4897661d1dde0d598e7dff37fd5ad6cf37bbf3ef3c149ac55b5f5e6803fd","pass.html":"8e9716f132263b0aa070ae659e538a8eded99404c74d6930c3f4edcf8ab06418","payouts/icons/apple-touch-icon.png":"92be9723bfd93667664b9b95faad98814797f4234abfc18019ee86913a379b4a","payouts/icons/icon-192.png":"5a91a352273691a55273d1a4c18461de1d259b63c409e711348fefe59d1378b8","payouts/icons/icon-512.png":"56a1b7ae11292a27300ff62fcf5882d4b617f756176bf1d42423275386c3dd8d","payouts/icons/icon-maskable-512.png":"63e86d4264628005c7cbd01c7af0f5e61dcc76a1a3822f37a5785d3a9a2ceb8f","payouts/index.html":"ea2dc01ad9468ce7639c25f6199b89f55623d1bee253e4e8f2ef196c375788ad","payouts/manifest.webmanifest":"826378c942f268ca87f6208bca8cbc8d73c8d578c62af9db3a4bab6522dc4855","prep.html":"39978b7cf460e4051b294d830cceefb4e502921216f83d94dc97ba5ac16a2067","q.html":"a7e8af3c72565e4246c6f5901edef79de861bfe0d621baf291527be0ad0718c6","qa.html":"2da0bfe997654a8eb5b4f84e3a3f86f4b53c972322d6106a91a9fed60334712b","quotes.html":"848a5321c6f862d65cb230464b863292c5779ace4b04df11962080dc12680c01","scripts-view.html":"5edf77c5df6ac42a04335cb6f2a5a857287bf25e11dad713adf90faa78854485","scripts.html":"97b734319732508b76d0fc2f32056f1497432e571da738e7dbcac7d1d2353bae","shoot.html":"863c0e871c2da1494e90c927bbbfa42c27e7e28fbc06096adc6ca4df2341d79b","staff-privacy.html":"452bf5e48ccec9f396a7090fdf763d5fd402e1f90c9decc87be3d375aab79a4f","status.html":"6756f8f5364962d80f891afe8ca24a5e7a1ea120a9226cc6e9c8a7854c0d8091","team.html":"dff62da59dd0ecbfc32f26ed76d7cfb99ceb1f94b18dad6fde5dff1ac3d85cca","year.html":"bd09aa550d7b0c43a060b1afc8212e462ee77072fa4831bf51500ba3d4071b38"}};
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
