<!--
  Copyright (c) 2026 Contributors to the Eclipse Foundation

  See the NOTICE file(s) distributed with this work for additional
  information regarding copyright ownership.

  This program and the accompanying materials are made available under the
  terms of the Apache License, Version 2.0 which is available at
  https://www.apache.org/licenses/LICENSE-2.0

  SPDX-License-Identifier: Apache-2.0
-->
<template>
  <figure class="doc-figure">
    <div class="doc-image-container" :style="{ maxWidth: maxWidth }">
      <img :src="resolvedSrc" :alt="alt" :style="{ maxWidth: maxWidth }" />
    </div>
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>

<script setup>
const props = defineProps({
  src: {
    type: String,
    required: true
  },
  alt: {
    type: String,
    required: true
  },
  caption: {
    type: String,
    default: null
  },
  maxWidth: {
    type: String,
    default: '350px'
  }
})

// The docs site is served under app.baseURL (e.g. /docs/): prefix absolute
// paths such as /images/... so they resolve to the docs' public folder.
const { baseURL } = useRuntimeConfig().app
const resolvedSrc = computed(() => {
  const src = props.src
  if (!src.startsWith('/') || src.startsWith('//')) return src
  const base = baseURL.replace(/\/$/, '')
  return src.startsWith(`${base}/`) ? src : `${base}${src}`
})
</script>

<style scoped>
.doc-figure {
  text-align: center;
  margin: 1.5em auto;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.doc-image-container {
  width: 100%;
  aspect-ratio: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.doc-image-container img {
  width: 100%;
  height: auto;
  object-fit: contain;
}

figcaption {
  font-size: 0.85em;
  color: #64748b;
  margin-top: 0.5em;
}
</style>
