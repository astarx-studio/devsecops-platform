<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>YADA DSOaaS</title>
    <script>
      (function () {
        var mode = "light";
        try {
          mode = localStorage.getItem("platform-color-mode") === "dark" ? "dark" : "light";
        } catch (e) {}
        document.documentElement.setAttribute("data-platform-mode", mode);
        var link = document.createElement("link");
        link.id = "platform-favicon";
        link.rel = "icon";
        link.type = "image/x-icon";
        link.href = "${resourcesPath}/favicon-" + mode + ".ico";
        document.head.appendChild(link);
      })();
    </script>
    <#if properties.styles?has_content>
      <#list properties.styles?split(' ') as style>
        <link rel="stylesheet" href="${resourcesPath}/${style}">
      </#list>
    </#if>
  </head>
  <body data-page-id="welcome">
    <main class="welcome">
      <section class="welcome-card">
        <div class="welcome-brand">
          <div class="welcome-brand-mark">
            <img class="welcome-logo-light" src="${resourcesPath}/logo-light.png" alt="YADA DSOaaS">
            <img class="welcome-logo-dark" src="${resourcesPath}/logo-dark.png" alt="">
            <span>YADA DSOaaS</span>
          </div>
          <button type="button" id="welcome-mode" class="welcome-mode" aria-label="Use the darker dawn">
            <svg class="welcome-mode-dark" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36A7 7 0 0 1 12 3z"></path>
            </svg>
            <svg class="welcome-mode-light is-off" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.76 4.84 5.34 3.42 4 4.76l1.41 1.41 1.35-1.33zM1 11h3v2H1v-2zm10-9h2v3h-2V2zm7.04 1.76 1.41 1.41-1.34 1.35-1.41-1.41 1.34-1.35zM17 11h3v2h-3v-2zm-5 8h2v3h-2v-3zm-6.24-1.84-1.41 1.41-1.35-1.34 1.41-1.41 1.35 1.34zM12 6a6 6 0 1 0 .01 12.01A6 6 0 0 0 12 6zm6.24 11.16 1.41 1.41-1.35 1.34-1.41-1.41 1.35-1.34z"></path>
            </svg>
          </button>
        </div>
        <div class="welcome-paths">
          <a class="welcome-path welcome-path-employee" href="${baseUrl?remove_ending("/")}/realms/devops/account/">
            <strong>Employee</strong>
            <span>Sign in to your YADA DSOaaS account.</span>
          </a>
          <#if adminConsoleEnabled>
            <a class="welcome-path welcome-path-admin" href="${adminUrl}">
              <strong>Admin</strong>
              <span>Sign in to look after the platform.</span>
            </a>
          </#if>
        </div>
        <#if adminConsoleEnabled && (bootstrap || successMessage?has_content)>
          <#if localUser>
            <h2>Create an administrative user</h2>
          <#else>
            <h2>Local access required</h2>
            <p>You will need local access to create the administrative user.</p>
          </#if>
          <#if successMessage?has_content>
            <p>${successMessage}</p>
          </#if>
          <#if bootstrap && localUser>
            <form class="welcome-form" method="post" novalidate>
              <#if errorMessage?has_content>
                <p>${errorMessage}</p>
              </#if>
              <label for="username">Username</label>
              <input id="username" type="text" name="username" autocomplete="username" required>
              <label for="password">Password</label>
              <input id="password" type="password" name="password" autocomplete="new-password" required>
              <label for="password-confirmation">Password confirmation</label>
              <input id="password-confirmation" type="password" name="passwordConfirmation" autocomplete="new-password" required>
              <label for="email">Email</label>
              <input id="email" type="email" name="email" autocomplete="email">
              <label for="firstName">First name</label>
              <input id="firstName" type="text" name="firstName" autocomplete="given-name">
              <label for="lastName">Last name</label>
              <input id="lastName" type="text" name="lastName" autocomplete="family-name">
              <input name="stateChecker" type="hidden" value="${stateChecker}">
              <button type="submit">Create user</button>
            </form>
          <#elseif bootstrap>
            <p>To create the administrative user, access the Administration Console over localhost, or use a <code>bootstrap-admin</code> command.</p>
          </#if>
        </#if>
      </section>
    </main>
    <script>
      (function () {
        var button = document.getElementById("welcome-mode");
        var toDark = button.querySelector(".welcome-mode-dark");
        var toLight = button.querySelector(".welcome-mode-light");
        function paint(mode) {
          document.documentElement.setAttribute("data-platform-mode", mode);
          toDark.classList.toggle("is-off", mode === "dark");
          toLight.classList.toggle("is-off", mode !== "dark");
          button.setAttribute("aria-label", mode === "dark" ? "Use the brighter dawn" : "Use the darker dawn");
          var favicon = document.getElementById("platform-favicon");
          if (favicon) favicon.href = "${resourcesPath}/favicon-" + mode + ".ico";
          try { localStorage.setItem("platform-color-mode", mode); } catch (e) {}
        }
        paint(document.documentElement.getAttribute("data-platform-mode") === "dark" ? "dark" : "light");
        button.addEventListener("click", function () {
          paint(document.documentElement.getAttribute("data-platform-mode") === "dark" ? "light" : "dark");
        });
      })();
    </script>
  </body>
</html>
