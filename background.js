(function () {
  "use strict";
  const runtime = typeof browser !== "undefined" ? browser : chrome;
  runtime.action.onClicked.addListener(() => {
    runtime.tabs.create({ url: runtime.runtime.getURL("index.html") });
  });
})();
