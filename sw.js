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
const BUILD = {"version":"71616a4e01b6627a","files":{"access.html":"925bade00174f5809b79c1bcbb874be2bc0eda5b3911c25b38fa4ffa20e89444","app/access-check-ui.js":"da48d8533a5b50511e9b7e1c7113bf790e0791ed094f455448577c4835a925cc","app/access-check.js":"1e24443baf7c300f643b5bbbccbbf971fe5c618ad9d2fb54c8c1fd0c1d928988","app/access-data.js":"3fe9ecf8bd36c04e71fe33b949649fb5f97966c68c6bdc0a13da7ecf553813cc","app/access-form.js":"a76b118001574aaf62610ae7cc86764aef2b17c207cb9a181e98f42217b73248","app/access-link-ui.js":"8710222a349bfed486b9cd675f7588ae0fd9653e61318e48d5d8121efdf2cf85","app/access-logic.js":"c3b2599edf933c6baa8296e0e8641c4b7eec55dbe1a7960893afab8de15ee147","app/access-nudge.js":"1591ad693817b357068ce891bcead9fa043175c2f95868487b1b0a584d4b3f1a","app/approvals-logic.js":"9a79515750c19c85557482995ff00baafa1f8f4def50ba7912f0f225d17ecdc9","app/approvals-ui.js":"2e87e5ffde8d1f3ee3a1c87c491c9eb56a2c99a4c253d22ad0324a398296afbc","app/ask-guide.js":"c3a35d882aa29368128fe76477390ad3ced48ba8fb07ac8214a007aa2ebde280","app/ask-logic.js":"cb745684562f9fcab5966c3a1197544c82b4291e994e201588ddce10ade28e16","app/ask-page.js":"3db2869e75e1196bf4db51cd43fc939c8e34367325ba00758068b29ce57580f4","app/assets/logo-mark.png":"2cd2f349d456cb9b3ec6296cd9f069f1ffe65d1bcacceff8c878067d812954a4","app/assets/logo.png":"f3449f67c8e000b64f4b70e4e1f4d416b3461f5bac4b3c8bc4bfd281cff826c3","app/auto-assign.js":"4f81af99bd039c217a7a348022fdb045595deeeb3321dc8b2c41625e17340ee1","app/availability-logic.js":"c40cec8d1d1331efb4026b74e08388434d7830c3b42f6355ea8b2acee93c60a0","app/availability-ui.js":"c224489aff62d4378a3c15737e99c27492171c278220da563b0941dfeccfa844","app/briefs.js":"84d702fcfa7640ef1152dba3009a3720e0bc89c888ef5f9d30648b6803a44c88","app/builder.js":"f1fe86bdc37fd3f7bc00f315b86bc5e021be14ebd5d007ecddba4c3536ada8a1","app/calendar-card.js":"df0915780ec8d93fb45735960f270adefc5ee165bc0e7365824a2f750b650344","app/calendar-feed.js":"bab9ff2cb692e74688a1ade87645b1337c0f41b13846d8cb46f00dd633d1f1f4","app/calendar-page.js":"5d6c4f17027cf7512e83ef269ca406e5d49f0fcfe62a0e0c2d285f20cf386d84","app/calendar-view.js":"70a8a9a1033c3eb9c5157c01c2c1de649be85dc169d3b1a6996f263d6327df7a","app/calendar.js":"a3d90813076a9bbada79b19b1a58d1ceea3db780778c274edd967d48335a6756","app/card-metricool.js":"27e0fc4c9b3e40fdc3690e4fd593ee3278926e5079d8dc4f24721d79ab0657ac","app/catalog.js":"6da2f0c70bcd0037eb930d59585883a80fc1cfd7bb1782a33d709a0bfdfb3351","app/characterization.js":"a9f88a5dbd8cdacdcbc3f7e8aa5f586ae73d75e202afa8d6fdee73e36c4ebfbf","app/client-card.js":"142c68564f36656286a1d31d5d2e82ede916eb7e23078fd740be69169c069b96","app/client-contact.js":"4b2a455fbeb79fc3b85938e8fbfc1dc8bcde3997cacdc4fbeb477d7232dfce7f","app/client-links.js":"3b0b9d9f37fcde761e125f8789ae5a685da13e477b16863528f59481608ae035","app/client-open.js":"3a382a62fdf30573fe8cfa623f938c33b78f2e5339cac7224ecca0ca983e21e8","app/client-search.js":"7b2441f9d5b963a0da4b619ac954481cc23218f559ba6ccb17dc9a1c3cc875d9","app/client-waits.js":"26e40be97dd7fae399b3d4457f05da772f1ec42ccacd966ddbb8bdba0c91ebf7","app/client.js":"4a46735b73393cfa00a93cd83546068b94ad444019c97bd650a49ac2d5644cc1","app/clients.js":"102d569995df4e1dea7dbb4649484dbd1546d4be7f78196596504ff4b864c621","app/clocks.js":"015f79f6d3e8e1b69548b4875419c172e8b74e0af19a6b8d9223c46710ba11df","app/contract-ai-logic.js":"f31e223a2e2912376e45557f2fa0358ae0646f3b7c66e7d2866111c91f2fee35","app/contract-end-ui.js":"d98df7952bae2974b3f93d4e8558699533a66bef04c6319f06c7b9210a3ebc37","app/contract-end.js":"b66cecd558d1d652468a99a3c95a2845e02fca302ff636921fea1bac165ac10b","app/contract-file.js":"67df4d4840647496a992a19f8a9e33a58f310fc4c34548e5bd8a88c423349261","app/contract-summary.js":"3c60c582f369edc1b75c5e4f555eb1d669d1187ca968786d914e0b29bea0327f","app/control-topics.js":"8199795d00e854040a3622a6c3fd5e372ea92618aa1d3333cdb635e3260b8241","app/dashboard.js":"b9a406e44ddeb3f6bb171edf4291d4d66a15068ed9d1e9048a7c52a9568df9c5","app/data-cache.js":"f85003eef3c2b98f3b141d443b5fe4e00e8c49b8d6c3ade78d26c20b75b9950c","app/date-set.js":"f56929a60d01ee14b858887f1ef3737a05ab895846d4471ab84a69ec62700215","app/day-summary.js":"0d24e7ee320e4ae6fc6025b56e45aec48ffec3ec304740d8ab5247a4311abb53","app/deal-data.js":"5f073e8cb070eb5eee1a8181c59e8472778ec6389002dddb5a89a0d9a22534bf","app/deal-logic.js":"6311310373bb516eb6c2b30c7f3f6ce79f0a9390c1cf61a110ca2b36ac432b98","app/deal-ui.js":"2eb541a8531c558bb9ad44ecacd4c9161a52b887bf86f862117c378897b866ec","app/deal.js":"c2c4e8cd3462a6231690c38bd33e45b850c11bcde01c4a721c23e5041efd4809","app/decisions-logic.js":"bb62314cd87808dba544a9d454bb56465dbe062ccc5b08b34e3ae5a6e0992626","app/decisions.js":"63e6389253d06949a47fa96131768e3e6197fb1a9f4575d0805058dbdd3b1c8f","app/drive-links.js":"d7d90b17a5d280089e7ff55abeab65f844c12e773110e72e66a5441f593f1a35","app/edit-count.js":"2dad82a67316bd3441c8021a4d6f83a6a16e2b82316f6a988d4a5d013b62ca0f","app/editor.js":"4b5d3f8ab656c38bc82e0a3cbd0d3a88d177ab8b0758f9baefdae7e15eef3290","app/fast-ladder.js":"e0513fdf9538222d012ad57cc0c8dc7587c8dcaa678937e7f5a7f0f45eba07d8","app/feel.js":"59e125c5ec2091ad8745c03d9483be37d259eaf865a897218b02da546c9534da","app/files-logic.js":"331fec12bd85f6b77955c5e1a170aa4602dad3816ee8f33947784056679e1326","app/files-ui.js":"d243aaaf2654b278046773fa164dc250a0b717af38dbd617fdccda28a850448d","app/fix-request-ui.js":"237abeb2bfe053807e3ba66285184dcc667792c67961fa1c8f2de78a329a090c","app/fix-request.js":"f949d7353fb9b739491334a8390da73431437fdd607cf10be48570437ac3a970","app/fonts/OFL.txt":"5163e9f9fda30f27c95700c375293baaf841afc890d8a8496113bc954a19ab7f","app/fonts/fonts.css":"84aa1405bf6ad2b9254f23e2afbe389d852308c8c4d8305fa97e9be4d28e2236","app/fonts/heebo-hebrew.woff2":"f1f7cfaef59431c7b391df81fb05520273303840bbe917213a2ab9f41b839675","app/fonts/heebo-latin.woff2":"50dae2e12dae22c920388023e35aaebcd1e1d27bbe915c83d64210377e083e60","app/fonts/jetbrains-mono-latin.woff2":"18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e","app/fonts/rubik-hebrew.woff2":"197b6dbe5c6bec7276c59b02d70a16ee6acd44322fc2f8d0226c07f8d57976c2","app/fonts/rubik-latin.woff2":"691cd1d9b4c0cdf31a1dcf04259c86f92c85e69f6622abab7964d81e36890691","app/fonts/varela-round-hebrew.woff2":"61f49780c3763145a924f538636d2e4aa190d614ea44a190758260896e4d804d","app/fonts/varela-round-latin.woff2":"03871f86c86fc776f89d0cb947502f3957181b63327fecaec724bc39d082319f","app/frame-guard.js":"b6e68dfdeab0aefbd99ae86d6138a4a99fc3e23eefba5cffd373732718a063c9","app/gallery.js":"a1f6ac4cc72ac8abc5a5aa51c7b7e91410a62fee337c535219c200ef98111476","app/gantt-brand.js":"fc1feca683270973a018306fb84d322ecdf28931eab2ef5d1f91bbc1dd11bce9","app/gantt-data.js":"8bed740098566afd9564fbabecba9f580a72f192180539f94f5ef6bacf57fdf2","app/gantt-drive.js":"78e8083c1df2a0863a62f1c4c5d94bc5a5e890480a7430bba0fc1e627540651f","app/gantt-index.js":"3b7c6654cf581080af963d89f1ce3f4e61f9ea1a70214c9e1993c26da7ef2715","app/gantt-logic.js":"304dc3be8f5f99092b65e29049360a028c257bb763a86e73ea29e8f6115c6974","app/gantt-template.js":"d64560bce00d1a4de816b99f839f07d6e7c9108ea77218ff5240a41a51d1eeed","app/gantt.js":"7b6b13c4ad6e79ba47b832c73fc6b559ce7ad41c697e59a7949c99fa0febb633","app/gcal-logic.js":"b594cce0088c8f732b81e2bd7b9580ccd1029c2695e8f9c21ba93f7d020b706e","app/gcal-page.js":"949b933e06689939fd15af5cc2d894f14770101040fb7c189ad66006de0f0532","app/handoff-ui.js":"3cd85b5165b7db50ce8e3a2a751d4894085ace53923adc0a8fe12b3895982aec","app/handoffs.js":"bc62b916966facb42f515f6c2b6592f35a3a1ec41d2d856b1594475094035511","app/health-ui.js":"114b88330f76f0d8d2ef6dd949428129dd069a6801ae84e07fb4578437428177","app/health.js":"01f469acbb79cf9a28921d0cffb704c762469519d83b03886a7ec2edc021d087","app/holidays.js":"abf016950aad8ec6044f8b59e21bf1865acb6c6cbffd5bfe38e8101935d75592","app/ics.js":"7dbc44707f531580f05eef0e5351e924c09e6f14b8488bc855b8d619f33d7c8f","app/ilai-card.js":"22ace26db50c69e6b3dc61db6201465231bc2dc69b1e561160cce500808bba7b","app/ilai-logic.js":"02e8b9b1210ac36cfe180e3b57bd025cf49db5bd85095c3dd2c1f23f4ba37148","app/insights-page.js":"35dd2b403fba97a2e9860a9411b67493311240f6f123af3a9fc5500435a4cd5c","app/insights.js":"9e7a436ac0a1a7edc818655a8960bf0bac5a95c2dcfaab6cb5d03f3320153ee0","app/intake-data.js":"77da50026e126f8c0fc46e874b57ce516fb99c32b2ea976751cfaa4fe3edb3cf","app/intake-ui.js":"ffae582a41d1e090a668756c9710372956d51db64fe598cb729f106d1990435d","app/intake.js":"10f4019112c7f377f2d28c790dccedeee0bbae08f5a6fc0deeea2b2394bee7b3","app/kit.js":"f23a96f50d5c335b118b360a49e994686bc88711391e59791d0f7e07d9909681","app/landing-control.js":"d0f8b07d3fd31b251d4ddb3aea6a35e8c9f3870fb09541bea8c6f1bd7785c196","app/landing-data.js":"03afd7efc0d1c60da64a839fc93ab0ff2620938ff688ee4b5d49c4d88817076f","app/landing-link.js":"b3c35c84126c0a695aae027728057a8b6ebdc1193eeb69771418d1528a55cd47","app/landing-logic.js":"9481e98c75600aab0048b47de1446d8e299fcb6958438a3ea6cda79e04d5f2d1","app/landing-ui.js":"7b039fb6188f415220f250c29df757291c04f337c12aedb2c3ed12733bf48751","app/late-chain.js":"19c8e589b4ffeff7cbc10554081a62d2c96a9a9402d800a795dcc4a1b301dfac","app/legacy-char-data.js":"04fa38b8e3521cbb8995673ecf4d1d822c6bbfcadeba4880cb7e5a4775205ba8","app/legacy-char-logic.js":"dd30f42233d8d458b83253828c8c5b73b02a7c80c5a187467cd4552015106a0f","app/legacy-char-ui.js":"fae67fab1ecec0d0e53012867c014eacabe1e38476870c529f8e91059f088c18","app/legacy-contract-full.js":"d3f3e8ccabc9085a6eea4e6df4cd12b76eaa0fffb78842587078fdb080309fa4","app/legacy-contract-logic.js":"8130d09795727d8650b23d9e76ae261bf940b3d28720357db0ac1b9c1c8c95e9","app/legacy-contract.js":"2b963f0b48ad4fe7ff675a4c0beb81297707e2aa717df199e07e3e0e904b1b6a","app/legacy-contracts-data.js":"56fb1bb66e7fe51f13fa8eeffa2382194b8f8f6f9ce2aa57acb724b284fc26fe","app/legal.js":"aba1ede7189fc8e66c7507e920488426fa301d40946d00c35570e71447835b1e","app/link-token.js":"4c7071749b1b38c57d7915fa3dc1f2f887080f74a9ffeb5f7b50076b5bf6aa62","app/log-brief.js":"c29e74e90867ba2e00d175e71ecd5d4da3d1fc92beb0560dc4f59bfe1d0a0802","app/login-gate.js":"a6ebfb294aad632130bf467d6a8818c653e156ddd185eebde6ec7041dffb730c","app/login-ui.js":"b8f309f41bd2bf79907903ac152e281ce93cfc340fe9d1f70ec3a2e2ef0916a3","app/manager-data.js":"85597fd7742480743c6e82fee52684968d53197b69821fa41ef8f2fcbf2c0147","app/manager-rules.js":"5784e5586d8d4645179862713ce7e06e524b2ffc16b60a27a5a59f8c90e3c4ae","app/manager-table.js":"cb751bb655e165d9e6d8c996a49006fbb9e223ee5540dedc72dc464f26906dc4","app/mark-guards.js":"c9947482fd192a9623487e2c95686a141df282d893efd1d40fbbc377e17e1236","app/messages-logic.js":"042ee0564ab3d2524957a256c664cc7ecabd6e3d15a61d68f9541e198dec0559","app/messages.js":"e2ba999a9b0969d7a5d6cdb72c43877fb4667917ed484712df36fe880d21c60f","app/metricool-connect-logic.js":"ff1495fdc0583ebfb407b111da0da912b998ddd14543f9fa3c6734030aaf77df","app/metricool-connect-ui.js":"017687954c5fcd42be7005e6c144e1f822d4e920d1f852b7a6153fe159058560","app/metricool-logic.js":"ff25c2c09a1857f9698a55b560272fdf66fa12770ca5ca9486a9031e2b6a4d50","app/metricool-team.js":"976c84ccb7087ee84c61fae2fc146c075c0c525cd2957bcac83ca5252719f2e4","app/mine-connect.js":"6c26da0ea8d25b13f8cf1a79418b50558541ddee6adca7c404cfb066b70452cd","app/mine-flow-data.js":"b3d4782660a54d68d4219e7f53acebfc7d7dbbc0103765ad988ff02a971cd16c","app/mine-flow.js":"dfb5982b074268fc1fe99b89f085d2ef83457e6685cacb18865c74f3f18a6e04","app/mine-metricool.js":"3c306431850994e230ea2215984eea601834d69eeb95cf693629e6d566010748","app/month-ui.js":"36d610a359334146f206c1a3d2514ba671c58633491e6ddd7681b4f60cad777f","app/monthly-shoot.js":"c8d4bfacf19956abdd732e9475656b1617509100c34d86efd95665def70e31d3","app/new-meeting-logic.js":"a56d1fa0aea7e7a3b8d9243f8fcc1126522577c8a51dbcbdcc2b24d2588f6ddb","app/new-meeting.js":"f7d39bc0eb9c38c8e1ebb2982fb540abe290f9a9441bc6149b07a2391d7f0762","app/now-bar.js":"f6efa99df522793dadfe41f28ac660cc8295c130787da13e082dbec4d60322a8","app/office-data.js":"154b2cfbd2e87e450176267bca6abcb788d412677c865f1be3175ab2a926a839","app/office-marks.js":"fb2476e4a2e6171faface2dfc2f89091f6358d397bcebd28115c72f87c3da759","app/office-ui.js":"588356415a1025aa85c52849324b32db3dac9896d88afdf06670e59cd24365e4","app/owner-data.js":"0348c0d304511a8ed3b2c2ab761e8fbf2ef81a079084f21b619409b2c1c60fa0","app/owner.js":"77eb05f0e37a06ef0618b2bb02648829c35be5042c48e7b95fad725664e1d847","app/pass-logic.js":"5a71537381dc86680d8e9ef079165a952adfd85d6a24d9ddbe169e3ade2c6416","app/pass.js":"27e33550d539bcfb5bf3547b4ee61b9c702c27fdbc1bd4de9dbdf7609d8853c9","app/payouts/app.js":"54ccd8ed9b1d10084ffe5b23644ee555b592f586a8a3ddd05b8bdc1d0912d8ac","app/payouts/client.js":"0931a4786e8a712694137ceb2b6031366818ae6d4efb64768b4217d355b20ed5","app/payouts/data.js":"0a7767abdd3eed3772571679b435ce4b827c451b66fa5e30c1ebc24343e7b6fd","app/payouts/door.js":"532ea19714e99897c7eb57fcd1a181932e05d89496f482cf6be0c846ca8ec03e","app/payouts/engine.js":"831e3f89ff5db0e9fe5c606ba96abf4cf9dfdf1aad536040a4100fadc9f7bd2a","app/payouts/gate.js":"5409be7ed9a7d3d6147066a0ef0ae3a12dc7a91831207830f79be140ea53d5de","app/prep.js":"d1c8dd7cc6603328e8ef17921e891d251ca725cfc38b7e09d5a17af76d015ecd","app/pricing.js":"66760f45f363b9eef531be2c0aac5a2f797fb8de049cc053e4005e7bf4e65f9d","app/production-data.js":"9a90da9be46004762dd4b270da162dac4e7a97a1d39ee98e44814314d133d70c","app/production.js":"1225df4cbe3762531e1f9e9b50d901c83c1e5bd471291099dc2f0adae292d16b","app/protocol-data.js":"a81a20eb241282c1340a5a6be113ac3e19f03a378a93a4d1d8fd64f47aa00852","app/protocol-logic.js":"834674a5c9af17f7e899a9c83ab1b98de984990cdf7ce11b40ff0d831eb932c9","app/protocol-ui.js":"9c00a1569117d3903b126e8a4f03138b658cb6b1d1395ed96e90ee406ce7f40a","app/protocol-versions.js":"00acfc3c8aa1f40390c656b2d41d68c8834d586ee2e52af6471e4be83f79424d","app/protocol.js":"0f16e9b327f12f6c80d86e3b44e3349ec8873700aab9544e745eec0975e01fe2","app/push-config.js":"b8fbb7f69ec84dea60a1bcdb43a59dfa69ce61e389b61c600214b53ae78f4d55","app/push-logic.js":"074ed6ec25a3412ca03387d8b030206d31d54febaf134aa2c82651c7ac9234fb","app/push.js":"888f2c6855037a844979b5d38ea8ce281040abd72d2ecaf01782dfe794b7bd27","app/qa-logic.js":"ec4e65a14ae41c19138f113f8e704afc55ce899ad35ce2887a1b8b61d559a56d","app/qa.js":"4d1b5866df96765270899850fcff6a91ae3a08b0521234749f96ea92dbfee5ef","app/questions-ui.js":"2b72df41eb8da6a91250932eebc7a7afdaba480d2952a12f6be5240f15842be6","app/quote-doc.js":"5fc86fc5a5bd6aa5fcfeaf9ad83551759eecb93669fbddc4abe4b4a725811e6f","app/reminder-engine.js":"1353e1424d9afed966acf39fac4ad799b9eeb6732b3975b6edf263286a238988","app/reminder-rules.js":"71bdb34da7e7984e352e592ddc009dfe5e576adee2b1ddedf4506a566266932c","app/renewals.js":"c3fd9a7200f0750d941151dfe41bce6a972d3d7668a19dae517e9506bba9623c","app/scripts-data.js":"3f1ee05eb7eb630f0371273b581064c4470b01b70816b5d037b4b2ffceeecab8","app/scripts-logic.js":"e7a56a59654c9ee049a92ca0398c875708a4f68aaa74755e0a78d9fe12383a4f","app/scripts-view.js":"71fc4e1f78ed92fa290ab16f1b2fdfcd55ac68897b31344a26e7a46273db8052","app/scripts.js":"ff35c9a19d1834b4425b85bae7bc158ea795ceff884b9b7794400266e04d926a","app/session-store.js":"116e9823dae1c5142550174f39eb09a3eacbfb119a718de77ebccc599093768b","app/set-password.js":"6c8ec25c4dd1ce3acf67984e175f2b2e18a16de1f9164adf85513a78317a0747","app/shell-gate.js":"55fc49602d0f14cc45be95e879903f0393d52a87830c4157bf4415cdfd7be46d","app/shell-rules.js":"dd3b4ba81b4bc409bedffe81b3cb6be3eb095def7aab0c0a0b7f977af4c89b8f","app/shell-state.js":"88d5fe6d67669c341ec8c507b7f61296ba01c0b6648152bd41f63cb871faac5c","app/shell.js":"19acc78a87cf5b0f0542d78116bb5e5f7f0a354fea709ec84893e60b3088c123","app/shoot-crew.js":"43fd099136600c3097438a7585df7ed393c27c3258683a10f4ff776c0699729c","app/shoot-prep.js":"8aa560c10fdfdbb13ee1f555f8b716632d3854fc6b384d9180c3852093c9dfbe","app/shoot-table.js":"3bb2bb01f6e2a78bfb8678f2b5194fe4b817ac288ff76a65a3b224e7d9b6056a","app/shoot.js":"bf75e378a3dc1df00e64a25e1b00b24215a2aff6a570bb09a479c22fa05fcf33","app/staff-tasks-logic.js":"b25e0c72789ead8bad2e5ea49d041caf8ba70c31669b9e2d755ec8423a4b5b27","app/staff-tasks-ui.js":"08beaf973741f5fdb7214953f8b46985d2eab2227b5ecad577009cbb27e70753","app/status-link-ui.js":"66feb7ff6d395fcfee2577b5caaa0b6b5a1e99e1f70676cd7a04b5b0da94a2b2","app/status-logic.js":"4c0280003799d031780d18e1c485f9e6eb6e45cf7e1903b4916daf7f2a14ccc0","app/status-rules.js":"dfdb5f1b56427daddc776827088a24b109ef4cc3357375c28726be0c9ae2fbc5","app/status.js":"2f279845c0316b59416bc3baa544a6d61af1036958868b91ed69c3777e9b0023","app/styles/access.css":"3562d531d946a6f206e58aeaca838213fe52e345c99935675e1f381b001deab6","app/styles/app.css":"aa8ce846339e7378ea4d9d6038993de6347549cbd5e7656274bdd932fe397932","app/styles/approvals.css":"a69b238314c15edd7586b6412d265d3cc20a39b206af5927a4528134c70e61fa","app/styles/ask.css":"b20769327be92b64f01c11d30886ae189e1fe1c28530a0742f319354e22f7230","app/styles/availability.css":"3eecd9efa885ce9525a343bfd1bf2a551653387c4926cc3d3c5510167d616736","app/styles/calendar-page.css":"c8d03fe5c62bb927c0385284d385ea82741a0fb6c88dfa04060d4ac8c7996d24","app/styles/calendar.css":"35b5240dfffb5d17b57aba3ea31368ec1dbeef97908782c3d75884cb14c68e93","app/styles/client-card.css":"94d96b4f1b334d5b70a107316486871e8b93b5751636d2d43eb8383cfab8ba97","app/styles/client.css":"738c74dd9b66df69264ea22b5309e800fa58ee20739bd139845a8d7bbbd5f7e5","app/styles/deal.css":"afcec6a92c429134a703b38eb9d9afd3759275cc3f2095a3effc1ee1d1f36723","app/styles/files.css":"60c84c02e30903b6b3505ec9c9a83bda20b4658d6756ee22bf322d93f1e781c3","app/styles/gallery.css":"119febf95008237ac6fed746aaaf235f4e6ca09b13e17c1dd9f9366298f0d126","app/styles/gantt.css":"b3dc1f85c76cb99cf9c608903087db70a23776962b0f836cd6a01aecb03914cd","app/styles/gcal.css":"d1b71b20244bb1ec2cb617328f75062b0103013e21b32361cc916832936737a0","app/styles/insights.css":"a2c72392f0ce707861c9b0d852a1b9d00414f764f11623d6a8d60075002aeff6","app/styles/intake.css":"05cea5f555e974492349b538322a4b6a6d69f798551752c53adb8544362b1e63","app/styles/kit.css":"c74262bb54dc10d71390993ea4edfe699c439e92b1f67f2a3ed5a2cb28b493b5","app/styles/landing.css":"c66a09dbdd518f46786635e057ecef0c948746ce5788ebad564bd371a4079d53","app/styles/legacy-char.css":"7c980e39ac7f786b29fa8453388b7e59474b208fbad79164c54b8950d5b59647","app/styles/legacy-contract.css":"3d3943cae4ff8fa3cef0e0eb53cae9c2166aceee514237559ae909c2f21434f5","app/styles/login.css":"a2e4875337a6e8c6120421485a4cdbe7b1be647ba0545822f290ba7650f930f1","app/styles/manager.css":"a88f988be4f76e0d77e0652f90a09df1d27e6eb15dbb3c7fec73efbe1e62ce0c","app/styles/messages.css":"b03b368e59ea379fc578fa4627e5433b4f9db50ed8a6d63d8269657dcb7d0d84","app/styles/metricool-connect.css":"46a4b6954814f867f089807a0acd1802a34e32840a58d6dd12936428e5dcb274","app/styles/nav.css":"5082a6fd68530185c4cd82244f53c2f61ed7fe6a61bf50219b67d2a8a63d0154","app/styles/office-flows.css":"f30884fbd2e10899a039a53f0003bc0ac184b8d36e08fbaa710bb9129bf1ae9e","app/styles/owner.css":"162849f3ad1ccda5cfd492a1205086856cb5d2531dad201b397e9f16f3e2bbf3","app/styles/payouts.css":"c813b271cbb3d3f0e8f920caa5cef065fae90a68f91e303619133653e209c3de","app/styles/production.css":"ed77177494aa804f1e68f443ca3f2a51efa2b25d86af137829ad37e9d6ec6e4d","app/styles/protocol-now.css":"7eef1b506d2474331a5f1e2022c01b472786a93a4cc85de909d9f1f98d1917d6","app/styles/protocol-office.css":"ced13afcecbb01286e89e48b5af692520a691df7ad3fdb06d46cf9f4c4d07ec8","app/styles/protocol-roles.css":"ec38d690d2e63e565d55c6a5f75866320ccd144f2f545bf005268b73e5214669","app/styles/protocol.css":"16e5956286bd65c9f707fce6020b6bcbd44a50b543f1a9bc95cfb0fa7c3530ad","app/styles/push.css":"1f7d7dd06401de46411521ba117b44e7aecc6ff460af045af7a49737118f6af6","app/styles/quote.css":"4d5b1baea5a7fa00286ecdc8b21ec0d8aae8d973dc384fdaa687a4f15694da47","app/styles/quotes.css":"0d535f4f8f8305f611879430ca53722e9e6e43f6415be2444c18ad917dbfff47","app/styles/scripts-view.css":"da3b7ebd40571c44fdd4d2ba93d708f4c960d1dc98ccb3d03550f85f2ee10e81","app/styles/scripts.css":"5d93baf1c471b91385c41511d5eca932a0c7150dd4b93b8250f482bf791d3665","app/styles/shell.css":"760e4a9dafb5b42892a7b21eb2a531b68b96e22833b580b98959322f54c4a666","app/styles/staff-tasks.css":"40d07949db837065f31ff06a25d868683195dad0d8acf41fe1b36c6b56d4e70c","app/styles/status-card.css":"3d2f386b2f7e885afd8e1dccf64c7faa944eb4abe7699226ca2c24cff6fbe782","app/styles/status.css":"84e895d17730bc44f19111add793153baf7b47b6adc8a872cac334317da5a79a","app/styles/team.css":"218806f56a9e027bd5819b6c750c9eba23a44f7f287817d2f836a01b9290f536","app/styles/tokens.css":"aed87f86b6d9b3d5df647429db28eba13a87c968baa11e7ec3781c0ef2879e4d","app/styles/whatsapp.css":"043d77cee016735843592a04cec50b16d8bac6fd8fc61f99f7539fd216032a5b","app/styles/year.css":"fbe8ef429c761643a9d10380d9fb99f9b7611438d6f7ebc28d2531fc47768324","app/supa.js":"1ba584e2bc05a93d00a7dd5210d822b4a86f8bd05f3a9896fba2680bf1c49a9c","app/surveys.js":"a4d4f9cd4e2479084c2f8f7ca24722eed3cf3f5372a0fcc9b8b7b5cd5ddd143a","app/team-rules.js":"87fbfad386801f29960a2a68d3be2fd165c29ff38f353657dbb77a281d010a05","app/team.js":"417c2cd9421e93e36d7b5f0751c44e5abe698704452fbd06529e8b073ac2b68c","app/turns.js":"ae392c891673fab2cdb38b39bced06725c99158d8e0bcd74e88b4935086f4748","app/tz.js":"ee0f143edf0a63b7ea240f3e83e53bbda2db1501a4e992dee63788fd0ec7fd32","app/unsigned-logic.js":"3f26e386c394fb81d9eae0763e65f1b57056424a7d239f57037d47d4d95514fa","app/upload.js":"5e851d69cc1f253be0c2533ded69efa517add9ef0323bbae9b47b677a4ea6c77","app/vault-code-team.js":"8e86d0950a13a4de6b893a6d47a8ba083a69c3c8a0500978bcd43a2f5c51a683","app/vault-code.js":"185a9610edde21c5402949f1ca3a9adc3b93495f7673dec38e7ad3cbfe9ca30a","app/vault-gate.js":"d7bd533353ac0d03875d4ba7967a5282935ad6e2df6b27372fd207a46a628f03","app/vendor/supabase.js":"649e46c496fae692ad4fc75ee1a9da5315f79029267cd4df847e7de192cacf77","app/visit.js":"224dc4a0e69dae6d1a4b03038509b09a68ca426961f7d7902fb31c394e75ed34","app/wa-logic.js":"5dfb62037fa4db329ba575355a035a15e671cea13bd3155748a27d353ef3b406","app/wa-team.js":"1d42baa7e2258f3f00c87a644afb73e11d3f9364b1197c93d8e1b771e76a6d02","app/wa-templates.js":"77d5cd7b2c2c7009cf6bda1f53efe4da2b18b83832f6ced40ee2b930ca155077","app/week-chart.js":"2399112320f3aa5c48a2a45ceb2d9de8c1e0ffa3163f7d75103b44d3b528cd36","app/whatsapp.js":"ba1b1a9ac99a8fca7f90457f95475a3b48a5e0d9fb93bf372ec2422c3a489d20","app/year-data.js":"a8c652ced94694b9794c3c71e27de06853e2422eb5d4dbef80249c0171125c74","app/year-logic.js":"4c2d7c7e32897837391d6a499eea264fbb8762e5aa0eb5e9697137d7c35313f4","app/year-rules.js":"7b2a7201d32ba774ec5b5f6b15ec730e257bcf3f33ea0b13d29c26951439e87c","app/year.js":"100979bdbb09429ec6f58d3f242938f28c1e1d73c8a1f129c0a6ce568591400e","ask.html":"37f2a46e51bd587d34497bc98e5199a1d1bd136461c9b730463291ff363418a1","calendar.html":"8a874b4cc786c03d606be9898c5d1f8982d33c6211f324c09501dd231867a581","client.html":"8b71a039c8037d684fad437f63939bc2c7b9b36ea6e5b9307b697991e6883a72","clients.html":"a79ef960f246272800a6d60b52ceef1cfbba1e3b745e5ab1ccefa5d185aab40b","clients.webmanifest":"26db9e715f603aa852bbfc7d347786b46a93148b00f53152612eece21025655a","deal.html":"b945a79ee9a2b1b2d51eb4697ceb18264b092479c8d7fc3dead844536da140c3","decisions.html":"9aaa79940cd15556be081bb822b17f8b77baa50ea28999b076400e5ba719a7ef","editor.html":"90fb0d9a87d611f5a31b43ef3dc8d87ad8c7f261b1a7135371aebd3e1df60a59","gallery.html":"bb1f481f6c49358e357c33ad2b275e647624d8aaa58477071a051816c7b6e4ba","gantt.html":"d09dd6fa20c56feed7dc5ca69cb1d52ca40e12ee1e90967c82ac924fbdd54712","index.html":"7a6d506762e5eeb2c0c884da8d47b9adf3139157882f313c17529ba88a5f5247","insights.html":"71b14985812162ad1939dd1e2d64c1622e047a23411c7192499a0fd3853fdcf6","intake-link.html":"a63a7987e9ffbeabfa3a79f053734605c1c1190d25fb777d22ea7054003914fa","intake.html":"37f23da4568307a582557558487828917b200a3e58b70212d000f8c83d369b44","landing.html":"08f509c9f135ac540c0681b4eb859b9fa408c48202ac439794ef133d67c0e245","legacy-contract.html":"06aef5256567a7d3b86d7f434ab85fd0b2420d7191f55c7b2ecfa6eefd3e6cc8","messages.html":"c5b24a8cf26000cf2d23e871106b8acb0693fe9000fde13aef8011bd71eb7013","owner.html":"03b8d35fe66d5555001d96af4e9dbd3d5c07af352d2821d6d61a7277e3fc6c43","pass.html":"8e9716f132263b0aa070ae659e538a8eded99404c74d6930c3f4edcf8ab06418","payouts/icons/apple-touch-icon.png":"92be9723bfd93667664b9b95faad98814797f4234abfc18019ee86913a379b4a","payouts/icons/icon-192.png":"5a91a352273691a55273d1a4c18461de1d259b63c409e711348fefe59d1378b8","payouts/icons/icon-512.png":"56a1b7ae11292a27300ff62fcf5882d4b617f756176bf1d42423275386c3dd8d","payouts/icons/icon-maskable-512.png":"63e86d4264628005c7cbd01c7af0f5e61dcc76a1a3822f37a5785d3a9a2ceb8f","payouts/index.html":"ea2dc01ad9468ce7639c25f6199b89f55623d1bee253e4e8f2ef196c375788ad","payouts/manifest.webmanifest":"826378c942f268ca87f6208bca8cbc8d73c8d578c62af9db3a4bab6522dc4855","prep.html":"c77ace1697b09daead868d78ee74afb7cc2df93aec988a317e04d3abfacd6b92","q.html":"a7e8af3c72565e4246c6f5901edef79de861bfe0d621baf291527be0ad0718c6","qa.html":"e43112f48b8b4a2adadda44b6b2476b7a2056cf87d89ffc044f1d935158803c2","quotes.html":"ebf675a78708f95224bbceb714f4b2465b372e01b2a649cc094de67e2804a4a0","scripts-view.html":"5edf77c5df6ac42a04335cb6f2a5a857287bf25e11dad713adf90faa78854485","scripts.html":"97b734319732508b76d0fc2f32056f1497432e571da738e7dbcac7d1d2353bae","shoot.html":"81806d2c40c299ea48815aea88cb8ca8c8e3af1b53a8b2e1ad77021b85b1d9ec","staff-privacy.html":"452bf5e48ccec9f396a7090fdf763d5fd402e1f90c9decc87be3d375aab79a4f","status.html":"6756f8f5364962d80f891afe8ca24a5e7a1ea120a9226cc6e9c8a7854c0d8091","team.html":"a364fe01c6966e038247c8f356ffe40536ddb8a054f881547ba2e37b2663b2c8","year.html":"bd09aa550d7b0c43a060b1afc8212e462ee77072fa4831bf51500ba3d4071b38"}};
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
