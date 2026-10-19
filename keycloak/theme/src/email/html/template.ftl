<#--
  Owned shell for YADA DSOaaS mail. Colors match src/theme/tokens.css.
-->
<#macro emailLayout>
<html>
<head>
  <meta charset="utf-8">
  <title>YADA DSOaaS</title>
</head>
<body style="margin:0;background:#4c628f;background-image:linear-gradient(168deg,#24325c 0%,#4c628f 18%,#8b7396 36%,#d48784 54%,#f0a35a 74%,#f6d3a0 100%);font-family:Segoe UI,system-ui,sans-serif;color:#241c18;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#4c628f;background-image:linear-gradient(168deg,#24325c 0%,#4c628f 18%,#8b7396 36%,#d48784 54%,#f0a35a 74%,#f6d3a0 100%);padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffaf4;border-radius:12px;padding:32px;">
          <tr>
            <td style="padding-bottom:24px;border-bottom:3px solid #e39a3c;">
              <img src="${url.resourcesUrl}/logo-light.png" alt="YADA DSOaaS" width="36" height="36" style="vertical-align:middle;border:0;">
              <span style="font-size:18px;font-weight:650;color:#128ea3;vertical-align:middle;margin-left:12px;">YADA DSOaaS</span>
            </td>
          </tr>
          <tr>
            <td style="font-size:15px;line-height:1.5;color:#241c18;">
              <#nested>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
</#macro>
