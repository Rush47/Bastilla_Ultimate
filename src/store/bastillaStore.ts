import { create } from "zustand";
import type { AgentId, SystemOverviewResponse, WorkspaceTab } from "../types/bastilla";

export interface BastillaState {
  activeTab: WorkspaceTab;
  selectedChatAgent: AgentId | "council";
  sidebarCollapsed: boolean;
  overview: SystemOverviewResponse | null;
  overviewError: string | null;
  lastSyncedAt: string | null;
  setActiveTab: (tab: WorkspaceTab) => void;
  setSelectedChatAgent: (agent: AgentId | "council") => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setOverview: (overview: SystemOverviewResponse | null) => void;
  setOverviewError: (error: string | null) => void;
}

export const useBastillaStore = create<BastillaState>((set) => ({
  activeTab: "desktop",
  selectedChatAgent: "aria",
  sidebarCollapsed: false,
  overview: null,
  overviewError: null,
  lastSyncedAt: null,
  setActiveTab: (activeTab) => set({ activeTab }),
  setSelectedChatAgent: (selectedChatAgent) => set({ selectedChatAgent }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setOverview: (overview) =>
    set({ overview, lastSyncedAt: new Date().toISOString(), overviewError: null }),
  setOverviewError: (overviewError) => set({ overviewError }),
}));
