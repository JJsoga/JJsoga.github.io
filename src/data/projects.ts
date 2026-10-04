export type ProjectField = {
	label: 'Architecture' | 'Contribution' | 'Evaluation' | 'Result' | 'Status';
	text: string;
};

export type FlagshipProject = {
	number: string;
	title: string;
	institution: string;
	descriptor: string;
	description: string;
	fields: readonly ProjectField[];
	keywords: readonly string[];
	diagram: 'audio' | 'breath';
};

export type CurrentProject = {
	number: string;
	title: string;
	institution: string;
	status: 'Current work';
	summary: string;
	detail: string;
	keywords: readonly string[];
};

export const flagshipProjects: readonly FlagshipProject[] = [
	{
		number: '01',
		title: 'Neural Audio Tokenization',
		institution: 'Tsinghua University',
		descriptor: 'Multi-scale discrete representation learning for neural audio systems.',
		description:
			'Explored discrete neural audio representations through a dual-stream quantization design with separate semantic and acoustic streams at different temporal resolutions. Worked on quantization-module development, alternative quantization designs, controlled baseline comparisons, and ablation-based evaluation.',
		fields: [
			{
				label: 'Architecture',
				text: 'Dual-stream semantic and acoustic modeling at 25 Hz and 50 Hz with finite scalar quantization.',
			},
			{
				label: 'Contribution',
				text: 'Quantization-module development and evaluation of alternative quantization designs.',
			},
			{
				label: 'Evaluation',
				text: 'Controlled baseline comparisons and component-level ablation studies.',
			},
		],
		keywords: ['Representation Learning', 'Neural Audio', 'Quantization', 'Multi-scale Modeling'],
		diagram: 'audio',
	},
	{
		number: '02',
		title: 'Cognitive-Breath',
		institution: 'University of Chicago',
		descriptor: 'Estimating cognitive load from respiratory signals captured through eyeglass nose-pad contact microphones.',
		description:
			'Developed an end-to-end pipeline for cognitive-load estimation from respiratory signals captured by contact microphones beneath eyeglass nose pads, spanning synchronized acquisition, signal preprocessing, respiratory feature extraction, cross-user modeling, optional personalization, and streaming inference.',
		fields: [
		{
			label: 'Evaluation',
			text: 'Cross-user evaluation, feature ablations, bilateral-channel fusion, acoustic and motion robustness, and sampling-rate / synchronization analysis.',
		},
		{
			label: 'Result',
			text: 'Online normalization and optional personalization improved block-level performance over the base cross-user model.',
		},
		{
			label: 'Status',
			text: 'Manuscript currently under review.',
		},
		],
		keywords: ['Statistical ML', 'Signal Processing', 'Cross-user Evaluation', 'Real-time Systems'],
		diagram: 'breath',
	},
] as const;

export const currentProject: CurrentProject = {
	number: '03',
	title: 'Open-Environment Multimodal Sensing',
	institution: 'Tsinghua University Future Lab',
	status: 'Current work',
	summary: 'Multimodal perception in open environments.',
	detail:
		'Exploring gas sensing, acoustic information, and thermal sensing, with current emphasis on environmental interference, sensor response, cross-scene generalization, and multimodal modeling.',
	keywords: ['Multimodal Sensing', 'Electronic Olfaction', 'Acoustics', 'Thermal Sensing'],
};
