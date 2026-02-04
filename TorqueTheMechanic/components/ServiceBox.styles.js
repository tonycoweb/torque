import { StyleSheet } from 'react-native';

export const BLUE = '#3b82f6';
export const GREEN = '#22c55e';

const styles = StyleSheet.create({
  // Entry tile
  container: { backgroundColor: '#333', borderRadius: 16, padding: 28, alignItems: 'center', marginVertical: 10 },
  disabledContainer: { backgroundColor: '#2d2d2d', borderColor: '#666', borderWidth: 1 },
  label: { color: '#aaa', fontSize: 15, fontWeight: '600' },
  mileage: { color: '#fff', fontSize: 19, fontWeight: '700', marginVertical: 6, textAlign: 'center' },

  modalWrapper: { flex: 1, backgroundColor: '#121212' },
  scrollContent: { flexGrow: 1, paddingBottom: 160 },
  modalBox: { backgroundColor: '#121212', borderRadius: 24, marginHorizontal: 16, elevation: 10, paddingBottom: 20 },

  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 4, width: '100%' },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 22 },
  modalTitle: { color: '#fff', fontSize: 22, fontWeight: '900', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  modalCloseText: { color: '#fff', fontSize: 22, fontWeight: 'bold', lineHeight: 22 },

  // Sticky header (absolute; no height animation)
  headerStickyAbs: {
    position: 'absolute',
    // top is now set dynamically from layout in ServiceBox.js
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 20,
    paddingHorizontal: 12,
  },
  headerStickyCard: {
    backgroundColor: '#0f0f0f',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 10,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  headerInner: {},

  // CTAs
  ctaBtnPrimary: {
    backgroundColor: BLUE,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  ctaBtnSecondary: {
    backgroundColor: GREEN,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  ctaBtnText: { color: '#0b1220', fontSize: 17, fontWeight: '900' },
  ctaHint: { color: '#9aa5b1', fontSize: 12, marginTop: 8, marginLeft: 4 },

  // Mileage card (inside header)
  mileageCard: {
    backgroundColor: '#1b1b1b',
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2b2b2b',
  },
  mileageBarLabel: { color: '#eee', fontWeight: '900', marginBottom: 6, fontSize: 15 },
  mileageInputRow: { flexDirection: 'row', alignItems: 'center' },
  mileageSaveBtn: { backgroundColor: GREEN, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12, marginLeft: 8 },
  mileageSaveText: { color: '#0b1220', fontWeight: '900' },
  mileageBarHint: { color: '#999', marginTop: 6, fontSize: 12 },

  // Search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 8,
    marginBottom: 2,
    backgroundColor: '#1b1b1b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2b2b2b',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    paddingVertical: 0,
  },

  // List + card
  serviceItem: { borderRadius: 10, padding: 12, marginBottom: 10 },
  serviceLow: { backgroundColor: '#424242' },
  serviceSevGreen: { backgroundColor: '#1f5f2a' },
  serviceSevYellow: { backgroundColor: '#8d6e00' },
  serviceSevRed: { backgroundColor: '#7f1d1d' },

  serviceCard: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    position: 'relative',
  },

  // Inactive ribbon
  inactiveRibbon: {
    position: 'absolute',
    left: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    zIndex: 2,
  },
  inactiveRibbonText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 0.4 },

  // Title & meta
  titleRow: { flexDirection: 'row', alignItems: 'flex-start' },
  titleText: { color: '#fff', fontSize: 20, fontWeight: '900', lineHeight: 26 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  dot: { color: '#ddd', marginHorizontal: 6, fontSize: 14, opacity: 0.8 },

  pillStatic: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    color: '#fff',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    overflow: 'hidden',
    fontSize: 13,
    fontWeight: '700',
  },
  pillEdit: {
    marginLeft: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
    color: '#fff',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '800',
  },
  pillLink: {
    color: '#FFD700',
    paddingVertical: 6,
    paddingHorizontal: 0,
    borderRadius: 999,
    fontSize: 14,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  inlineEditWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 6, marginTop: 6 },

  // Small inline buttons
  smallBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10 },
  smallBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  // Delete button
  deleteBtnBig: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 2,
    alignSelf: 'flex-start',
    marginLeft: 6,
  },

  // Badges
  badgeRow: { flexDirection: 'row', gap: 10, marginTop: 10, marginBottom: 10 },
  badge: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  badgeLabel: { color: '#bbb', fontSize: 12, fontWeight: '700' },
  badgeValue: { color: '#fff', fontSize: 16, fontWeight: '900', marginTop: 2 },

  // Inverted progress
  progressWrap: {
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  progressHint: { color: '#ddd', marginTop: 8, fontSize: 13, fontWeight: '700' },

  // Details panel
  detailsPanel: {
    marginTop: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  detailKey: { color: '#ccc', fontSize: 13, fontWeight: '800', width: 140 },
  detailVal: { color: '#fff', fontSize: 13, flexShrink: 1 },

  // Inputs (base)
  inlineInput: { backgroundColor: '#111', color: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#444', paddingHorizontal: 10, minWidth: 90, marginHorizontal: 4 },

  // Proofs
  proofRow: { marginTop: 8 },
  proofRowContent: { flexDirection: 'row', alignItems: 'center' },
  thumbnailContainer: { marginRight: 8, borderRadius: 8, width: 70, height: 70, zIndex: 1 },
  thumbnail: { width: '100%', height: '100%', borderRadius: 8 },

  // Actions — equal widths for a tidy grid
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionBtnEqual: {
    flexBasis: '48%',
  },
  actionPrimary: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  actionNeutral: { backgroundColor: 'rgba(255,255,255,0.10)', borderColor: 'rgba(255,255,255,0.15)' },
  actionOutline: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.25)' },
  actionPurple: { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
  actionTextPrimary: { color: '#0b1220', fontSize: 13.5, fontWeight: '900' },
  actionText: { color: '#fff', fontSize: 13.5, fontWeight: '800' },

  // FAB
  addFab: {
    position: 'absolute',
    right: 22,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },

  // ---------------- SHEET / OVERLAY ----------------
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    elevation: 99999,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  sheet: {
    backgroundColor: '#0f0f0f',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '900', flex: 1, textAlign: 'left', paddingRight: 16 },
  sheetClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  sheetCloseText: { color: '#fff', fontSize: 22, lineHeight: 22 },

  sheetFooterRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingTop: 8 },

  // Inputs
  labelStrong: { color: '#eee', fontWeight: '900', marginTop: 8, marginBottom: 6, fontSize: 14.5 },
  helperText: { color: '#9aa5b1', fontSize: 12, marginTop: 4 },

  input: {
    backgroundColor: '#111',
    color: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputLg: {
    backgroundColor: '#111',
    color: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  inputMultiline: {
    backgroundColor: '#111',
    color: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    minHeight: 110,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inputRowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  inputRowButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Form grid
  formRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  formCol: { flex: 1, minWidth: 140 },

  // Segmented
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    marginBottom: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  segmentActive: { backgroundColor: '#22c55e' },
  segmentText: { color: '#ddd', fontWeight: '800' },
  segmentTextActive: { color: '#0b1220', fontWeight: '900' },

  // Banner
  banner: {
    color: '#d6ffe4',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '700',
  },

  // Image viewer
  viewerShell: { width: '95%', height: '82%', backgroundColor: '#080808', borderRadius: 14, overflow: 'hidden', borderColor: '#222', borderWidth: 1 },
  viewerTopBar: { height: 46, backgroundColor: 'rgba(0,0,0,0.55)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, borderBottomColor: '#111', borderBottomWidth: 1 },
  viewerTopBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8 },
  viewerTopBarText: { color: '#fff', fontSize: 14 },
  viewerImageWrap: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  chevron: { position: 'absolute', top: '45%', backgroundColor: 'rgba(0,0,0,0.45)', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  pager: { position: 'absolute', bottom: 10, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  pagerText: { color: '#fff', fontSize: 12 },

  // Thinking overlay
  thinkingCard: {
    width: '86%',
    maxWidth: 420,
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 22,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  spinnerRow: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 12,
  },
  thinkingTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  thinkingSub: { color: '#9aa5b1', fontSize: 13, textAlign: 'center', marginTop: 6 },
});

export default styles;
