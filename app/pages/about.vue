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
  <div>
    <nav>
      <NuxtLink :to="`/`" class="button">
        <Icon name="uil:arrow-left" :title="$t('about.back')" />{{ $t('about.back_homepage') }}
      </NuxtLink>
    </nav>
    <h1>{{ $t('about.title') }}</h1>
    <p>{{ $t('about.tool_description') }}</p>
    <p>
      <a :href="`${docsUrl}/methodology/qsos-manifesto`" target="_blank">
        {{ $t('about.read_manifesto') }}
      </a>
    </p>
    <p>
      <a :href="`${docsUrl}/methodology/introduction`" target="_blank">
        {{ $t('about.read_docs') }}
      </a>
    </p>
  </div>
</template>
<script setup lang="ts">
// The documentation site is served by the same host under /docs
// (proxied to the docs server), in the current UI language.
const { locale } = useI18n()
const docsUrl = computed(() => `/docs/${locale.value === 'fr' ? 'fr' : 'en'}`)
</script>