<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { FolderOpen } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

defineProps<{
  jdbcDriverSelectItems: { id: string; label: string }[];
  selectedJdbcDriverPath: string;
  isDesktop: boolean;
  connectionLabelClass: string;
  connectionLabelTopClass: string;
}>();
const emit = defineEmits<{ select: [value: unknown]; browse: [] }>();
const driverClass = defineModel<string | undefined>("driverClass");
const jdbcDriverPathsInput = defineModel<string>("paths", { required: true });
const jdbcManualClasspathOpen = defineModel<boolean>("manualOpen", { required: true });
const jdbcManualClasspathCount = computed(() => jdbcDriverPathsInput.value.split(/\r?\n/).filter((path) => path.trim()).length);
const { t } = useI18n();
</script>

<template>
  <div class="grid grid-cols-4 items-start gap-4">
    <Label :class="connectionLabelTopClass">{{ t("connection.jdbcDriverPaths") }}</Label>
    <div class="col-span-3 space-y-2">
      <Select v-if="jdbcDriverSelectItems.length > 0" :model-value="selectedJdbcDriverPath" @update:model-value="emit('select', $event)">
        <SelectTrigger>
          <SelectValue :placeholder="t('connection.jdbcDriverSelectPlaceholder')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="driver in jdbcDriverSelectItems" :key="driver.id" :value="driver.id">
            {{ driver.label }}
          </SelectItem>
        </SelectContent>
      </Select>
      <div class="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
        <div class="flex min-w-0 items-center gap-2">
          <div class="truncate text-xs font-medium">{{ t("connection.jdbcManualClasspath") }}</div>
          <Badge variant="outline" class="h-5 shrink-0 rounded-full px-2 text-[10px] font-medium">
            {{ t("connection.jdbcManualClasspathCount", { count: jdbcManualClasspathCount }) }}
          </Badge>
        </div>
        <Switch v-model="jdbcManualClasspathOpen" />
      </div>
      <div v-if="jdbcManualClasspathOpen" class="flex items-start gap-1">
        <textarea
          v-model="jdbcDriverPathsInput"
          class="flex min-h-12 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          :placeholder="t('connection.jdbcDriverPathsPlaceholder')"
        />
        <Tooltip v-if="isDesktop">
          <TooltipTrigger as-child>
            <Button type="button" variant="outline" size="icon" class="h-9 w-9 shrink-0" @click="emit('browse')">
              <FolderOpen class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ t("connection.jdbcDriverBrowse") }}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  </div>
  <div class="grid grid-cols-4 items-center gap-4">
    <Label :class="connectionLabelClass">{{ t("connection.jdbcDriverClass") }}</Label>
    <Input v-model="driverClass" class="col-span-3" :placeholder="t('connection.jdbcDriverClassPlaceholder')" />
  </div>
</template>
