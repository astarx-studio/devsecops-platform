<#--
  Owned shell for YADA DSOaaS mail. Colors match src/theme/tokens.css.
-->
<#macro emailLayout preheader="">
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>YADA DSOaaS</title>
</head>
<body style="margin:0;padding:0;background-color:#4c628f;background-image:linear-gradient(168deg,#24325c 0%,#4c628f 18%,#8b7396 36%,#d48784 54%,#f0a35a 74%,#f6d3a0 100%);font-family:Segoe UI,system-ui,sans-serif;color:#241c18;">
  <#if preheader?has_content>
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>
  </#if>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#4c628f;background-image:linear-gradient(168deg,#24325c 0%,#4c628f 18%,#8b7396 36%,#d48784 54%,#f0a35a 74%,#f6d3a0 100%);">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;background-color:#fffaf4;border-radius:16px;">
          <tr>
            <td style="padding:28px 32px 20px;border-bottom:3px solid #e39a3c;">
              <img src="${url.resourcesUrl}/logo-light.png" alt="" width="36" height="36" style="vertical-align:middle;border:0;border-radius:8px;">
              <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#128ea3;vertical-align:middle;margin-left:12px;">YADA DSOaaS</span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 32px;font-size:16px;line-height:1.6;color:#241c18;">
              <#nested>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#fffaf4;">YADA DSOaaS</p>
      </td>
    </tr>
  </table>
</body>
</html>
</#macro>

<#macro button href label>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0;">
  <tr>
    <td align="center" bgcolor="#128ea3" style="border-radius:10px;background-color:#128ea3;">
      <a href="${href}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:Segoe UI,system-ui,sans-serif;font-size:15px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;">${label}</a>
    </td>
  </tr>
</table>
</#macro>
