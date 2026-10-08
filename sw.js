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
const BUILD = {"version":"d8a1aff4d0f5e056","files":{"access.html":"925bade00174f5809b79c1bcbb874be2bc0eda5b3911c25b38fa4ffa20e89444","app/access-data.js":"3fe9ecf8bd36c04e71fe33b949649fb5f97966c68c6bdc0a13da7ecf553813cc","app/access-form.js":"c603b76260710129758f4ef1f9433ae087f4ac0d3b4d8f4f172288bb5cea5488","app/access-link-ui.js":"8710222a349bfed486b9cd675f7588ae0fd9653e61318e48d5d8121efdf2cf85","app/access-logic.js":"d1af8e05266dcfefba90e6ef9c205365553ebdb7940a745505cfc8667283ec6c","app/access-nudge.js":"1591ad693817b357068ce891bcead9fa043175c2f95868487b1b0a584d4b3f1a","app/approvals-logic.js":"9a79515750c19c85557482995ff00baafa1f8f4def50ba7912f0f225d17ecdc9","app/approvals-ui.js":"7a6e66cc8b99b22f65f02cc5277fff19b8e1559f1d953375d023caa4a109e50b","app/assets/logo-mark.png":"2cd2f349d456cb9b3ec6296cd9f069f1ffe65d1bcacceff8c878067d812954a4","app/assets/logo.png":"f3449f67c8e000b64f4b70e4e1f4d416b3461f5bac4b3c8bc4bfd281cff826c3","app/auto-assign.js":"07ae54da15b704d647bfceb08322e7dd7aeb0f31566217e5dc8a68484e00905a","app/availability-logic.js":"dc5458118c8a61474670e5fb01720229abc316865c5839ddaed8f8856b0fb217","app/availability-ui.js":"973462d90b3d89347da9d10aa433af75c3dde89aa225d5f834a0a43f776204a9","app/briefs.js":"84d702fcfa7640ef1152dba3009a3720e0bc89c888ef5f9d30648b6803a44c88","app/builder.js":"41dfbce5c8125f874cae39b1da88274b9f77770643593886f9ca0f8ebec0543d","app/calendar-card.js":"bc437675a5b386f2c528580ba5afb19a1067022e60f89cb4b26b3b9717674a55","app/calendar-feed.js":"447f79ef524595e8fe7b2a0af7a83953a3685fba2afa2d3c1e194557cbb71f27","app/calendar.js":"d3e9d34c2379728bbdc62d1428db263f97a1c22cb549929d9948c53a2a0e2e28","app/catalog.js":"f3f84fab12be0e9bd272798205918b1bf7d29815cc3de7c679249538e5edf5c1","app/characterization.js":"db72366dbe696d19c75e604cfd62551a50b9cbef68ad04daa3cacb28ba0726d2","app/client-card.js":"af023a51b5219d60169370911b55d53e0acb5031b07c93e0554aa81c29b00ea1","app/client-open.js":"1de2023c40cfb410b94ed9af72c79c86fb6e6fd73a4455778676c5cf9d3a3431","app/client.js":"4cf9318f7723f5768211c4ae00d3f64695f40e2a54de390e507867b5cb778b1a","app/clients.js":"62e2834b8382c558897eb52892bf8b6b6ec2b518d56b2c82431991e1a090a9af","app/clocks.js":"e738d252afda79e1842cb2b6edd4d0668bfb0d73612f2915880b2654b873c558","app/contract-summary.js":"3c60c582f369edc1b75c5e4f555eb1d669d1187ca968786d914e0b29bea0327f","app/control-topics.js":"5f3525e039cc5e49b92ef00e23fc2f9d5bbaee3b8d5b354f76e2a90835871335","app/dashboard.js":"ce51b029751176a9a1898a714eb7346bd477b7921733cb9936caa9d8a7ccc5e7","app/deal-data.js":"5f073e8cb070eb5eee1a8181c59e8472778ec6389002dddb5a89a0d9a22534bf","app/deal-logic.js":"e3de454adc1d7fb2770ae695779b1ef7337d21020fa8bf12daa6265526306573","app/deal-ui.js":"2eb541a8531c558bb9ad44ecacd4c9161a52b887bf86f862117c378897b866ec","app/deal.js":"1fc8e638de403cf3990c670b809af147ffd1693c49a1cc11663d1c07805dee03","app/decisions-logic.js":"b16b2579bd5edcb6be142697e33329e8857ccaecc79fc5b440e7cfb948d8c157","app/decisions.js":"40176e7924685c2d2d10c74d2a0fd55cb24277f4b85aa1a81e7bb31ece46d93c","app/editor.js":"73676dfa3fb4607afbe8fd88074868a7b69f69073ff23df429dd424f26216158","app/feel.js":"59e125c5ec2091ad8745c03d9483be37d259eaf865a897218b02da546c9534da","app/files-logic.js":"0afda0c542718c84160cf7a2ef8e168a5fabe2d55bc88dd34158fa7a4cbb1a4f","app/files-ui.js":"3138b3d2dcecb573ffeb24e624e7886af84f6f32e296a8f3d472ffa636e0f756","app/fonts/OFL.txt":"5163e9f9fda30f27c95700c375293baaf841afc890d8a8496113bc954a19ab7f","app/fonts/fonts.css":"84aa1405bf6ad2b9254f23e2afbe389d852308c8c4d8305fa97e9be4d28e2236","app/fonts/heebo-hebrew.woff2":"f1f7cfaef59431c7b391df81fb05520273303840bbe917213a2ab9f41b839675","app/fonts/heebo-latin.woff2":"50dae2e12dae22c920388023e35aaebcd1e1d27bbe915c83d64210377e083e60","app/fonts/jetbrains-mono-latin.woff2":"18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e","app/fonts/rubik-hebrew.woff2":"197b6dbe5c6bec7276c59b02d70a16ee6acd44322fc2f8d0226c07f8d57976c2","app/fonts/rubik-latin.woff2":"691cd1d9b4c0cdf31a1dcf04259c86f92c85e69f6622abab7964d81e36890691","app/fonts/varela-round-hebrew.woff2":"61f49780c3763145a924f538636d2e4aa190d614ea44a190758260896e4d804d","app/fonts/varela-round-latin.woff2":"03871f86c86fc776f89d0cb947502f3957181b63327fecaec724bc39d082319f","app/frame-guard.js":"b6e68dfdeab0aefbd99ae86d6138a4a99fc3e23eefba5cffd373732718a063c9","app/gallery.js":"f1239351869a69d6aabfb90d491e27f85f6467894e8147f420fb50f78899bea8","app/gantt-brand.js":"18e775406d5f5421197e8d5f805cfedc220ffe2f1f1279aa6614410ef3dae08f","app/gantt-data.js":"fb0dcd59119161c4cd8addb42637ddf573378a999b18305326bdebdc96a679da","app/gantt-index.js":"1883a378bad91a60e555d18f84636a4bfb09a68300df9b2052b0fb4811c630bf","app/gantt-logic.js":"f535886eaa9cf1ff1e3b5a1d66e0e5b7a69284c1cb65e2e7fc4fef6d72021cae","app/gantt-template.js":"d64560bce00d1a4de816b99f839f07d6e7c9108ea77218ff5240a41a51d1eeed","app/gantt.js":"f6fcd136a4a7ecc15c403e44687218150bef5dde016bf435b5cf7f92e2bb9614","app/handoff-ui.js":"a61839bec8a9383c34dcc7d20e3855bf741ec18edd4a673235bfa2b9e1a8d668","app/handoffs.js":"9443be2e5efe3471c49c74634b32d88ea11e9066936f7c2a62732cb3f0efd15e","app/health-ui.js":"114b88330f76f0d8d2ef6dd949428129dd069a6801ae84e07fb4578437428177","app/health.js":"fb037a53550a15c20d16cd1af0b24016c9338a22f75c56cab85fd3c62d454f50","app/holidays.js":"abf016950aad8ec6044f8b59e21bf1865acb6c6cbffd5bfe38e8101935d75592","app/ics.js":"7dbc44707f531580f05eef0e5351e924c09e6f14b8488bc855b8d619f33d7c8f","app/ilai-card.js":"67ce3cef0ecab3e225c23c649449b2c5786690e811691f8767b5387cc1d5077e","app/ilai-logic.js":"60e263b8c555cb8f65dce50ddcb241cef44868d8b11e2889475433962dc2c495","app/insights-page.js":"d1346c4ce49b5847965d04ee5b61537697d35843e612dbd6ac3f58cbe1ad65c9","app/insights.js":"8088d7cc5294ffff0c06114e85c9ee9bb7c677c99a98c0c7bd890e041b1b80d2","app/intake-data.js":"77da50026e126f8c0fc46e874b57ce516fb99c32b2ea976751cfaa4fe3edb3cf","app/intake-ui.js":"2f838d2e785e6c8e33571ae5063ef4275aaf5040fa6052e90fefbf451fcbab04","app/intake.js":"52cf10a44121fb09e9c071cf549144ffa31f3f3534c14434bb30d7f6105a03ef","app/landing-control.js":"227370dd6ea4bc917bd46dc3316524553b9c92f15b9aae61c2a908c59ceb3d45","app/landing-data.js":"c2c58efe539a70f8ab64dce3be5787c418934f9c4a1af3d541a25c0bd30ff353","app/landing-logic.js":"7139f6d14f70a6f758d90d6c6f4e913a81304b0091aecfed4fd7d479e0d7f0b6","app/landing-ui.js":"4428f3692a164d89fe6b7203618b72e978c711338d017eb133fbb5e152e724d3","app/legal.js":"07ab7703a28952c4b64d4116332279303a3b22991f68c999092629acdbf63be1","app/link-token.js":"4c7071749b1b38c57d7915fa3dc1f2f887080f74a9ffeb5f7b50076b5bf6aa62","app/manager-data.js":"85597fd7742480743c6e82fee52684968d53197b69821fa41ef8f2fcbf2c0147","app/manager-rules.js":"74ac10bdf573241f6ef9cb55ac7adb14b39fe446d5eee397ec9ef1fed551bd93","app/manager-table.js":"1474b707eeb4f7cfe61fd49560320362c6c22a945a1f5fc833e0f5aabe6a5654","app/messages-logic.js":"11fa767b2184a0b364466c93b20707479b764bdcdf76fb7dad4666b72768cef4","app/messages.js":"7b8856d5c78865594924dc32d6eea92a27438144e1ba034f3586ca3c1a5705d8","app/metricool-connect-logic.js":"1bd1cf2688fa19bc9fa99f927afbb6c987c7fbe8038700e45def2b113441b455","app/metricool-connect-ui.js":"e2dbd62a0463d44c28089ebaf9117c8c594621cb44166206fe961fbcd1b12c2a","app/metricool-logic.js":"793cf13618240bee1d2d0189a228accc451e7635865c1f40148790d1c0166334","app/metricool-team.js":"976c84ccb7087ee84c61fae2fc146c075c0c525cd2957bcac83ca5252719f2e4","app/month-ui.js":"4deae012bf3f72cb7e4f638a9bcaf78755a0a395e74a53005a527a10ebd1c954","app/now-bar.js":"b6d357e69e2245b330046352c2861ec8bda60991b75492f13f7530a08fdafa60","app/office-data.js":"42d4fcaee4d67953ad273422df5b0230df850bc3299edfb95a98c7c5f30ac30e","app/office-marks.js":"8520ae5df9e2a7c8126522d2b8431144c434ce635f1dcb0cd700ba39958df594","app/office-ui.js":"82972eed7bb336b32d015ae61c5188d0be6751267f182269cf7d5a5536c28a67","app/owner-data.js":"0348c0d304511a8ed3b2c2ab761e8fbf2ef81a079084f21b619409b2c1c60fa0","app/owner.js":"cbcf008c12e0cffea8ec723dbf18d57aa0221e1977677602b869ef4f8a57a687","app/pass-logic.js":"c646e968a1d9736c58d9b65bb1909e92b8d0031b3fd35d25f6776489bb947712","app/pass.js":"73b3dc87780529af321d32f567e6501f53ac27966a80b823ffc8c677ab559719","app/payouts/app.js":"341da9f43584f376558222f6bfc276931efe2dc396b34fd135a22eccf58cb95c","app/payouts/client.js":"0931a4786e8a712694137ceb2b6031366818ae6d4efb64768b4217d355b20ed5","app/payouts/data.js":"0a7767abdd3eed3772571679b435ce4b827c451b66fa5e30c1ebc24343e7b6fd","app/payouts/engine.js":"ad944d1ca1732122913bc277feb77491f893f37a8634b5a98ae8752a4e4fa09f","app/prep.js":"fd4f0d69c0b4708f581eec39710b613863c30ac285d76e9e4281ad5caf2d26a5","app/pricing.js":"2b63a0beb2149899db2de51cac8309ceb5b0742b9d8abaf55ac102a4eb34fdc7","app/production-data.js":"1c09b35954f5575e07b913175aae9ce3a7dcc2ae807bfb7d1f4a78f3baad9209","app/production.js":"4cc098a3e66ff3937921285ce54ee2a99b2dcbd69196e9d81854a810451a3fa2","app/protocol-data.js":"4e512af6dada9699ecdb1a524f34144beb855e6dbcdc0ab80178d5c58c570945","app/protocol-logic.js":"7b2a02da3a5c0bc1bcea79b68cfae6b2f804eff387abc276536bdbca2d6d2566","app/protocol-ui.js":"59aaf5be2debf659899dd1b583d9906c6c6fa8b07f23b38a1ecd94d3a70d8733","app/protocol-versions.js":"bbbf33d72fe6e39e4111d3350a3849c8cc08293bdc6a5ab0c971850afb8d0d09","app/protocol.js":"2ece74590bada9fdc4cc7822aa87167c57aae6b3784a99168683c4dd03730af1","app/push-config.js":"b8fbb7f69ec84dea60a1bcdb43a59dfa69ce61e389b61c600214b53ae78f4d55","app/push-logic.js":"4f642388f598039ff2315bedb8c87dc43b7cd70770c38c5445c15d471b193b22","app/push.js":"6e6938ae126bb39c3506940138c2a5d43d47526af8e50b88df6b568341270d9f","app/qa-logic.js":"1aba155684da07e9c8b4450c45b46e8406db4eba97556aff87cadaad2963b706","app/qa.js":"9b33355b730ddeec5c5d3c6cb8b81c8fa29e02d6575e53a0b58c56def8ee2461","app/questions-ui.js":"2b72df41eb8da6a91250932eebc7a7afdaba480d2952a12f6be5240f15842be6","app/quote-doc.js":"5fc86fc5a5bd6aa5fcfeaf9ad83551759eecb93669fbddc4abe4b4a725811e6f","app/reminder-engine.js":"8eb1bcd19aef8ec69617222a9b88555268a61d5fc39fc0ad6411d90b323bc0fc","app/reminder-rules.js":"bfee5029ed383b6cc8848ef4e8592bfa84f694c0303e6d7c4d0a18d1cc48fa65","app/renewals.js":"3172f3da40d75b90bdde10bce80de32ed99e7d9c063147642f58a47dc5366ef0","app/scripts-data.js":"3f1ee05eb7eb630f0371273b581064c4470b01b70816b5d037b4b2ffceeecab8","app/scripts-logic.js":"244b81636adedf277e355aa8c7ffe45d74c2214e0f231e21303fd0b2a05ae7fe","app/scripts-view.js":"b69af62f9ad3dd51c4868e065c13431a04b53b158afcc52e6a3a9d28bfb0c20f","app/scripts.js":"5e621a38c02a9370611f7147ba6228483dd3bb69900c2842b08424d242844d1e","app/set-password.js":"6c8ec25c4dd1ce3acf67984e175f2b2e18a16de1f9164adf85513a78317a0747","app/shell-rules.js":"5dd7cf1ca86c5e740bea7b48a5d1612dfa35a8b12b45d5939f808bc02eecfc25","app/shell.js":"24c08b6c7df635f4f6ed3c0209a8ebb13158d961e33b928b51c86ec80539694b","app/shoot-prep.js":"73f6734f76286a4d9cce0df177bf11f66522ea4ab46c58cbc182c883f1c130f6","app/shoot-table.js":"12f545104d622d5ded896d874ee1197103ff9c01de2090662f45d43dcd95e2c5","app/shoot.js":"acc55d58ea8c3dbed78dda8dc066ebe08c75c2c730d42e00119c447534106016","app/staff-tasks-logic.js":"a4e9831108d037eeeb7cb48499d59768426fb93a8c0b079dac4820a511f0c3e3","app/staff-tasks-ui.js":"bd28b2c345c20d805602113ba28a2da3b06fdc28ce2231b80112ec79f01bb18e","app/status-link-ui.js":"05ba9f5b611bb5c8bf5412468d0eea7b4911da952ef1ebccaf8537de7c56673a","app/status-logic.js":"4c0280003799d031780d18e1c485f9e6eb6e45cf7e1903b4916daf7f2a14ccc0","app/status-rules.js":"5e3e7ab539c6987c4ad8eaa09a7db8358b8e9ab01893f68901da78bda23f154f","app/status.js":"442c1954e8b808e8eae023ea9b76bd666f8ba6db092d3b7ecded3f8b922476ee","app/styles/access.css":"250823ea6b359f083995b298fac9091bff653cacf82e3aa801ab88e2647c987b","app/styles/app.css":"941ffdf9558ac4f5df29a9dabdb9ff6f77b089df0160eda6ca8f5c0884c1522c","app/styles/approvals.css":"d046530389c8b393e754112213377edf9238809ff5c0daaf763983a65eea9d40","app/styles/availability.css":"b999f6ea20b0a78a1a85217a62f385268f198a245b5f216626ab7fcfbdb046b8","app/styles/calendar.css":"35b5240dfffb5d17b57aba3ea31368ec1dbeef97908782c3d75884cb14c68e93","app/styles/client.css":"95df07dc3ab0b7f8e7f39491419a0ccf8852ee50417c0a15db90061c2f6fb38a","app/styles/deal.css":"388b86469c46c6b5e8cba9710e63a105f3f77b87adbbfef52899732d6e8700b4","app/styles/files.css":"c69fd7e1462e1357edf6f2ebdb402b332f6511bcc056013391bb2a258df1d6ba","app/styles/gallery.css":"61a391677ff745173161e81940431c2512d86c0882ac400e4664fb2657ab9144","app/styles/gantt.css":"aab3ca38ccacad68822365f47dab0a134c624dc45b5a7b306950de79478ea51b","app/styles/insights.css":"fb75ebd908fb5eead991a67c2fcad5b26bc69f6b39c6883621c1a12f44c93a0e","app/styles/intake.css":"a68caf32f6467085a6ef1a6328714f6040b3829c464a9c9f65c59ff96e8bcede","app/styles/landing.css":"e72782c34e9be3b4d7bf97206ade3d25fa3eea094d650e0c19a93eb0d304f8d8","app/styles/manager.css":"88b7f097e15331ad408679a9a52065e0f7f0754b130101807ccad325a0e2c400","app/styles/messages.css":"745a80b5ae4a0a92cb82b0f2e7813d73fadac32c0ad0646f346b54d67f0f41a1","app/styles/metricool-connect.css":"1ae0a0861a263a2ea636c6a522108a27d0ec1ccb06c57e1b0ec4b10724a31563","app/styles/office-flows.css":"2f35e72ada0b748f6a3561f9f795faef5c0337f4181811e565167d634ce91ff7","app/styles/owner.css":"2aa63b01b1dcd95160ed025d3a548c1e65ebddf4874c819d456cefd67c83a23b","app/styles/payouts.css":"f6e5a5d1d8ec4ea94632d965451fda2da978a6e9060652ee9f8fc607817f5358","app/styles/production.css":"84c634c83cfaeba72cf399cbe182243a41ba1ff89464e8cfa1937faefcc5077e","app/styles/protocol-now.css":"41c08e450bc358ce9b5f56eca4967e409a562a42bb0f9673eb58698aaa576ca3","app/styles/protocol-office.css":"2851fb1d7feafd844733ffe67f1701439a148b897d7fb73e0f126401abc90611","app/styles/protocol-roles.css":"e147ec1fb63f2a5cc0488b16ecdfaecb1c63908d2d858b6fce373223d236a317","app/styles/protocol.css":"a527de09874105e396e9f23bd40a73c3faa09ab2cd52d181d32c7792fa9c3067","app/styles/push.css":"591688264e39f072d350a185227a600a7cdb9ab97e68078aa13d63123798e670","app/styles/quote.css":"4d5b1baea5a7fa00286ecdc8b21ec0d8aae8d973dc384fdaa687a4f15694da47","app/styles/quotes.css":"90b635150e6549a272cf8e2d8f919e56258919f48e02136d20fcfb01f2e7ee19","app/styles/scripts-view.css":"4091e0f6508fac5b8d389283245a7d314bc6cf96f9d976f364fbe121030a976e","app/styles/scripts.css":"7854dfc78636d6d79e083812703a680088a775f7b4d3b184c4402161acb5d752","app/styles/shell.css":"bd3ec3a5bad0b88c69dbf3535bd41d6173ae05df0f45e215c2edcf7874189d95","app/styles/staff-tasks.css":"8312b030b8d38a3993ada01707a48340916e216d0409775fc22cdce69c09d487","app/styles/status-card.css":"83a91a2cb5a69afe94a13dbc8bcd298f87bd4a3afe6dcd7db7027916a4326fc8","app/styles/status.css":"73a16d1a95a3f270a053fa895d3655c4d7199946998f085bafb19c116634a6b6","app/styles/team.css":"09a4b06622c49a08349770ca4253fe2c2afcd85d43d32e134303e2e6d98f116e","app/styles/tokens.css":"aed87f86b6d9b3d5df647429db28eba13a87c968baa11e7ec3781c0ef2879e4d","app/styles/whatsapp.css":"043d77cee016735843592a04cec50b16d8bac6fd8fc61f99f7539fd216032a5b","app/styles/year.css":"c4f06f9a389524304ec22e5664d573e1fb417a849f7708912ebb64377a2e5f20","app/supa.js":"ffb1956a41ab8aca355f1f65465673c054881b432a7e2b7f0fe8bda1347a41ef","app/surveys.js":"a4d4f9cd4e2479084c2f8f7ca24722eed3cf3f5372a0fcc9b8b7b5cd5ddd143a","app/team-rules.js":"87fbfad386801f29960a2a68d3be2fd165c29ff38f353657dbb77a281d010a05","app/team.js":"f6753767d97d6ee69db6ff2f1d209f0925b54e09c2d1cc9adf56b3dcf2b3db03","app/tz.js":"ee0f143edf0a63b7ea240f3e83e53bbda2db1501a4e992dee63788fd0ec7fd32","app/upload.js":"5e851d69cc1f253be0c2533ded69efa517add9ef0323bbae9b47b677a4ea6c77","app/vault-code-team.js":"8e86d0950a13a4de6b893a6d47a8ba083a69c3c8a0500978bcd43a2f5c51a683","app/vault-code.js":"185a9610edde21c5402949f1ca3a9adc3b93495f7673dec38e7ad3cbfe9ca30a","app/vault-gate.js":"d7bd533353ac0d03875d4ba7967a5282935ad6e2df6b27372fd207a46a628f03","app/vendor/supabase.js":"649e46c496fae692ad4fc75ee1a9da5315f79029267cd4df847e7de192cacf77","app/wa-logic.js":"03735685c30cd2b428fd4b74b4f9253891dc8f500f2c9622336ef8efaa921b4f","app/wa-team.js":"114bce61e9899d4f373532d3c8ca2d852beafe2cee0864e6876d52f2f9aab19d","app/wa-templates.js":"18ee85d5efaf5e3ca5ad0ab58a94edfdbc3312ecd9f30990b7f903da97ac65d5","app/week-chart.js":"2399112320f3aa5c48a2a45ceb2d9de8c1e0ffa3163f7d75103b44d3b528cd36","app/whatsapp.js":"c6cae6fc1ed6a6372689daa49cb90fbda6fa94527ccb0769950569cfdab62f78","app/year-data.js":"a8c652ced94694b9794c3c71e27de06853e2422eb5d4dbef80249c0171125c74","app/year-logic.js":"4c2d7c7e32897837391d6a499eea264fbb8762e5aa0eb5e9697137d7c35313f4","app/year-rules.js":"bbf8341a77e81122aa2f7b5aac516b5527d3e6aab66e784608fb3a5829f4d382","app/year.js":"62cf4159525a31d24f8fcb71594630e2940ac40502391e8860cb7cf626057e6d","client.html":"0a43e572d538fc448495a8439a1b9407042bd34edde82841cadc5637a16b8e65","clients.html":"31eb8733878ea96f4285e4a71420d4e6960b9c866f332b8ba8acc0154dd1a601","clients.webmanifest":"dffd9dbdf193e2f83b7b7f9204b4ddc44355bf78148be05f3e03e3566db4bbca","deal.html":"776d76eba5cc2c66e5aabfadf003d13502c34fe3e6d54da708e860e3e3a83f60","decisions.html":"f1dcb86b2b8a59480a8955884bc6b36bea3e1739996a1ee88f83205dbec38c49","editor.html":"c2836152335fd4c404d625c08c68ca30e2ef0b53acd9ae248725df7d291ec2e2","gallery.html":"50891ad0c6b3b6cda3a514edcd09289a03e6ce43a6e1f60456af171249eb83ee","gantt.html":"b1e911cb36b0a01688d081af6332fdfdefa639261da10003fbdcf33dc9c4fc37","index.html":"7185b1fd685730a764ffed08c289b05acdaf118de5e8f0237c3ac50ea5286f30","insights.html":"f7bd238fc6d132b71059649f00747218e48b4a7a63cf4493c569253c89570107","intake.html":"1885a5973947e42b417312cd29df5d85c2301dd372814c739a9a3b95188e3204","landing.html":"6dd2788b6fceeec4ac900eb8ac556b0e2e646e5dcf6d47c6c6c8616f4b32295f","messages.html":"76242c9dd76b72a1d0582d7e82b250580567abb6b5b972016cb14d498e1ac569","owner.html":"8d63cecdc47d8a517002cd8ba187f0a0f1999af422398205dbb25bb3599123f9","pass.html":"d435703d921e9c236e273da14417baccd14777ee752819c770a79fe4c85fc2c8","payouts/icons/apple-touch-icon.png":"92be9723bfd93667664b9b95faad98814797f4234abfc18019ee86913a379b4a","payouts/icons/icon-192.png":"5a91a352273691a55273d1a4c18461de1d259b63c409e711348fefe59d1378b8","payouts/icons/icon-512.png":"56a1b7ae11292a27300ff62fcf5882d4b617f756176bf1d42423275386c3dd8d","payouts/icons/icon-maskable-512.png":"63e86d4264628005c7cbd01c7af0f5e61dcc76a1a3822f37a5785d3a9a2ceb8f","payouts/index.html":"fd08a1027e31e98082bee70c9a6f743842555e566aec79afe27cb2ba0122607c","payouts/manifest.webmanifest":"94f87d9f9a4f8d93f7e20d21e0dfcfaa81513db9271dd5984fe146c082516ac5","prep.html":"df6ca3c394ebf8598d22f1f099ebd6b596ed0c93d79b423dab02bca3df3225f0","q.html":"ac22165c693dff06cbcd6e7efc4498fbba9ee2b2b95c2412ffa4abdba014ffc3","qa.html":"81f45ce4f73c60ca2993c4788fc95839ce600ddb93006807bb0775720b352d87","quotes.html":"3cafc3d9547331c865d553bcfa51512c93c2ee9f7c1c46329ec5d4c01aa14931","scripts-view.html":"441dd2d10ffcf2f7d59d6efa56723752b58b7e157695553b54c90076f17c5109","scripts.html":"b29d26778c36135e54f887021a5e663ded4dd8b4c2bcbc3afc0665505f65a98f","shoot.html":"62f6e642be3140b57eec1d7bfc2e395e2040240670b79db392245d95e3fa517e","staff-privacy.html":"b49d64da4c7c64bc4e15a1e8f7492a34faf02fb40ff95af2d6442aa8b67e82b6","status.html":"fe6649e880a6551316360b212d33e3135c11962758c7150fbbd55fe48ccdbf85","team.html":"eb8541fc87f699e9695601a31ad659bf32701a98b5ef05df033d340bb355e5bf","year.html":"6cd5307c636a135096ace52e1d519227b96a65b2a05b3bd75855dd4b79b85855"}};
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
