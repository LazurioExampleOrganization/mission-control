// Layout patterns adaptují původní Mission Control předlohu pro Organization MCv3
// (sidebar, collapsible, version-badge), ze které byla tahle aplikace adaptována.

import type { ReactNode } from 'react';
import { useEffect, useId, useState } from 'react';
import { missionControlBrand } from '../instance/brand.ts';
import { type IconName, navSections, type PageId } from './navigation.ts';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'mission-control:sidebarCollapsed';
// Pod touto šířkou se navigace sama sbalí na ikonovou lištu, aby obsah dostal
// prostor; uživatel ji může dočasně rozbalit, ale volba se nepersistuje.
const COMPACT_LAYOUT_QUERY = '(max-width: 1100px)';
// Pod touto šířkou se navigace přesune do horní lišty a vysouvacího panelu.
const MOBILE_LAYOUT_QUERY = '(max-width: 700px)';

const WORKSPACE_RUNTIME_KIND = import.meta.env.VITE_WORKSPACE_RUNTIME_KIND as string | undefined;
const WORKSPACE_RUNTIME_LABEL = import.meta.env.VITE_WORKSPACE_RUNTIME_LABEL as string | undefined;
const WORKSPACE_RUNTIME_SUMMARY = import.meta.env.VITE_WORKSPACE_RUNTIME_SUMMARY as
	| string
	| undefined;
const MISSION_CONTROL_PLAN_CODE = import.meta.env.VITE_MISSION_CONTROL_PLAN_CODE as
	| string
	| undefined;
const WORKSPACE_WORKTREE_CODE = import.meta.env.VITE_WORKSPACE_WORKTREE_CODE as string | undefined;

function readSidebarCollapsed(): boolean {
	if (typeof window === 'undefined') return false;
	try {
		return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
	} catch {
		return false;
	}
}

function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState<boolean>(() => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
		return window.matchMedia(query).matches;
	});

	useEffect(() => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
		const media = window.matchMedia(query);
		const update = () => setMatches(media.matches);
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	}, [query]);

	return matches;
}

function SidebarIcon({ name }: { name: IconName }) {
	switch (name) {
		case 'roadmap':
			return (
				<svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
					<path d='M3 6h18M3 12h18M3 18h12' />
				</svg>
			);
		case 'shaping':
			return (
				<svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
					<path d='M12 4v16M4 12h16' />
					<circle cx='12' cy='12' r='8' />
				</svg>
			);
		case 'ready':
			return (
				<svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
					<circle cx='12' cy='12' r='8' />
					<path d='m8 12 3 3 5-6' />
				</svg>
			);
		case 'in-progress':
			return (
				<svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
					<circle cx='12' cy='12' r='8' />
					<path d='M12 7v5l3 2' />
				</svg>
			);
		case 'review':
			return (
				<svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
					<circle cx='11' cy='11' r='7' />
					<path d='m20 20-3.5-3.5' />
				</svg>
			);
		case 'done':
			return (
				<svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
					<path d='M20 11.5V12a8 8 0 1 1-4.7-7.3' />
					<path d='m9 12 2 2 7-7' />
				</svg>
			);
		case 'archived':
			return (
				<svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
					<path d='M3 7h18v3H3zM5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9' />
					<path d='M10 14h4' />
				</svg>
			);
		case 'board':
		case 'agent-work':
			return (
				<svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
					<rect x='3' y='4' width='18' height='16' rx='2' />
					<path d='M9 4v16M15 4v16' />
				</svg>
			);
		case 'coverage':
			return (
				<svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
					<path d='M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-8' />
				</svg>
			);
		case 'check':
			return (
				<svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
					<path d='M5 12l5 5L20 7' />
				</svg>
			);
		case 'plus':
			return (
				<svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
					<path d='M12 5v14M5 12h14' />
				</svg>
			);
	}
}

function WorkspaceRuntimeBadge() {
	if (
		WORKSPACE_RUNTIME_KIND !== 'development_worktree' &&
		WORKSPACE_RUNTIME_KIND !== 'invalid_worktree_location'
	) {
		return null;
	}

	const planCode = MISSION_CONTROL_PLAN_CODE || WORKSPACE_WORKTREE_CODE;
	const label =
		WORKSPACE_RUNTIME_LABEL || (planCode ? `Vývojová kopie ${planCode}` : 'Vývojová kopie');
	const summary =
		WORKSPACE_RUNTIME_SUMMARY ||
		'Tahle aplikace běží z development worktree, ne z lokální main kopie.';
	const tone = WORKSPACE_RUNTIME_KIND === 'invalid_worktree_location' ? 'invalid' : 'development';

	return (
		<aside className={`workspace-runtime-badge workspace-runtime-${tone}`} aria-live='polite'>
			<strong>{label}</strong>
			<span>{summary}</span>
		</aside>
	);
}

export function Layout({
	activePage,
	onNavigate,
	children,
	headerSlot,
}: {
	activePage: PageId;
	onNavigate: (page: PageId) => void;
	children: ReactNode;
	// Globální slot vpravo nahoře (vedle version badge) — sem míří draft
	// indikátor, aby byl viditelný na každé stránce.
	headerSlot?: ReactNode;
}) {
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
	const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(readSidebarCollapsed);
	const compactLayout = useMediaQuery(COMPACT_LAYOUT_QUERY);
	const mobileLayout = useMediaQuery(MOBILE_LAYOUT_QUERY);
	const [railExpanded, setRailExpanded] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const sidebarId = useId();

	useEffect(() => {
		if (!mobileLayout) setDrawerOpen(false);
	}, [mobileLayout]);

	useEffect(() => {
		if (!compactLayout) setRailExpanded(false);
	}, [compactLayout]);

	useEffect(() => {
		if (!drawerOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setDrawerOpen(false);
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [drawerOpen]);

	// Mobil: vysouvací panel vždy s popisky. Kompaktní okno: ikonová lišta,
	// pokud ji uživatel dočasně nerozbalil. Široké okno: uložená volba.
	const effectiveCollapsed = mobileLayout
		? false
		: compactLayout
			? !railExpanded
			: sidebarCollapsed;

	const toggleSidebar = () => {
		if (mobileLayout) setDrawerOpen((open) => !open);
		else if (compactLayout) setRailExpanded((expanded) => !expanded);
		else setSidebarCollapsed((value) => !value);
	};

	const navigate = (page: PageId) => {
		setDrawerOpen(false);
		onNavigate(page);
	};

	const toggleLabel = mobileLayout
		? drawerOpen
			? 'Zavřít menu'
			: 'Otevřít menu'
		: effectiveCollapsed
			? 'Rozbalit menu'
			: 'Sbalit menu';

	useEffect(() => {
		try {
			window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? '1' : '0');
		} catch {
			/* ignore storage errors */
		}
	}, [sidebarCollapsed]);

	const toggleSection = (label: string) => {
		setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));
	};

	return (
		<div
			className={`app-layout${effectiveCollapsed ? ' sidebar-collapsed' : ''}${mobileLayout ? ' is-mobile' : ''}`}
		>
			{mobileLayout ? (
				<header className='app-topbar'>
					<button
						type='button'
						className='app-topbar-menu'
						onClick={toggleSidebar}
						aria-label={toggleLabel}
						aria-expanded={drawerOpen}
						aria-controls={sidebarId}
					>
						<svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
							<path d='M4 7h16M4 12h16M4 17h16' />
						</svg>
					</button>
					<div className='app-topbar-brand'>
						<strong>Mission Control</strong>
						<span>{missionControlBrand.organization}</span>
					</div>
					<div className='app-topbar-slot'>
						{headerSlot}
						<div className='version-badge'>Lazurio v3</div>
					</div>
				</header>
			) : (
				<div className='top-right-slot'>
					{headerSlot}
					<div className='version-badge'>Lazurio v3</div>
				</div>
			)}
			<WorkspaceRuntimeBadge />
			{mobileLayout && drawerOpen && (
				<button
					type='button'
					className='sidebar-backdrop'
					aria-label='Zavřít menu'
					onClick={() => setDrawerOpen(false)}
				/>
			)}
			<nav
				id={sidebarId}
				className={`sidebar${effectiveCollapsed ? ' is-collapsed' : ''}${mobileLayout ? ' is-drawer' : ''}${drawerOpen ? ' is-open' : ''}`}
				aria-hidden={mobileLayout && !drawerOpen ? true : undefined}
			>
				<div className='sidebar-top'>
					{!effectiveCollapsed && (
						<div className='sidebar-header'>
							<h1 className='sidebar-title'>Mission Control</h1>
							<span className='sidebar-context'>{missionControlBrand.organization}</span>
						</div>
					)}
					<button
						type='button'
						className='sidebar-toggle'
						onClick={toggleSidebar}
						aria-label={toggleLabel}
						title={toggleLabel}
					>
						<svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
							<path
								d={
									mobileLayout
										? 'M6 6l12 12M18 6L6 18'
										: effectiveCollapsed
											? 'M9 6l6 6-6 6'
											: 'M15 6l-6 6 6 6'
								}
								stroke='currentColor'
								strokeWidth='2'
								strokeLinecap='round'
								strokeLinejoin='round'
							/>
						</svg>
					</button>
				</div>

				<div className='sidebar-nav'>
					{navSections.map((section) => {
						const sectionOpen = !collapsed[section.label];
						return (
							<div key={section.label} className='sidebar-section'>
								{!effectiveCollapsed && (
									<button
										type='button'
										className='sidebar-section-header'
										onClick={() => toggleSection(section.label)}
									>
										<span className={`sidebar-chevron ${sectionOpen ? 'open' : ''}`}>&#9654;</span>
										<span>{section.label}</span>
									</button>
								)}
								{(effectiveCollapsed || sectionOpen) && (
									<div className='sidebar-section-items'>
										{section.items.map((item) => {
											const tooltip = `${section.label}: ${item.label}`;
											return (
												<button
													type='button'
													key={item.id}
													className={`sidebar-item ${activePage === item.id ? 'active' : ''}`}
													onClick={() => navigate(item.id)}
													data-tooltip={effectiveCollapsed ? tooltip : undefined}
													aria-label={effectiveCollapsed ? tooltip : undefined}
												>
													<span className='sidebar-item-icon'>
														<SidebarIcon name={item.icon} />
													</span>
													{!effectiveCollapsed && (
														<span className='sidebar-item-label'>{item.label}</span>
													)}
												</button>
											);
										})}
									</div>
								)}
							</div>
						);
					})}
				</div>
			</nav>

			<main className='content-area'>{children}</main>
		</div>
	);
}
