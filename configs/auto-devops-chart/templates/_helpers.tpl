{{/*
=============================================================================
dsoaas-app chart helpers
=============================================================================
*/}}

{{/* Expand the name of the chart */}}
{{- define "dsoaas-app.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Full release name: truncated to 63 chars. Helm release name is already the
effective slug; no chart-name suffix needed.
*/}}
{{- define "dsoaas-app.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Chart label: name-version */}}
{{- define "dsoaas-app.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Common labels applied to all resources */}}
{{- define "dsoaas-app.labels" -}}
helm.sh/chart: {{ include "dsoaas-app.chart" . }}
{{ include "dsoaas-app.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: dsoaas
{{- end }}

{{/* Selector labels used by Deployment + Service */}}
{{- define "dsoaas-app.selectorLabels" -}}
app.kubernetes.io/name: {{ include "dsoaas-app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Image reference: combines repository and tag.
Both are required and must be provided by the pipeline.
*/}}
{{- define "dsoaas-app.image" -}}
{{- if and .Values.image.repository .Values.image.tag -}}
{{ .Values.image.repository }}:{{ .Values.image.tag }}
{{- else -}}
{{- fail "image.repository and image.tag are required" -}}
{{- end -}}
{{- end }}

{{/*
Name of the K8s Secret that contains the app's runtime secrets.
Matches the ExternalSecret target name (= release name).
*/}}
{{- define "dsoaas-app.secretName" -}}
{{- include "dsoaas-app.fullname" . }}
{{- end }}
