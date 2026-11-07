#!/bin/sh
# Apply the OpenShift pieces and show their status. Run from the repo root after building the image.
set -e
oc apply -f deploy/openshift/api.yaml
oc apply -f deploy/openshift/inferenceservice.yaml
oc apply -f deploy/openshift/tekton-pipeline.yaml
oc apply -f deploy/openshift/pingsource.yaml
oc get inferenceservice reuse-gate-kserve
oc get pipelines.tekton.dev reuse-gate-verify
oc get pingsource reuse-gate-radar-ping
