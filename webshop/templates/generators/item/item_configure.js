class ItemConfigure {
	constructor(item_code, item_name) {
		this.item_code = item_code;
		this.item_name = item_name;

		this.get_attributes_and_values()
			.then(attribute_data => {
				this.attribute_data = attribute_data;
				this.show_configure_dialog();
			});
	}

	show_configure_dialog() {
		const fields = this.attribute_data.map(a => {
			return {
				fieldtype: 'Select',
				label: a.attribute,
				fieldname: a.attribute,
				options: a.values.map(v => {
					return {
						label: v,
						value: v
					};
				}),
				change: (e) => {
					this.on_attribute_selection(e);
				}
			};
		});

		this.dialog = new frappe.ui.AttributeDialog({
			container_selector: "#my-custom-dialog-attribute",
			title: __('Select Variant for {0}', [this.item_name]),
			fields,
			on_hide: () => {
				set_continue_configuration();
			}
		});
		this.dialog.$status_area = $("show-status-area");

		this.attribute_data.forEach(a => {
			const field = this.dialog.get_field(a.attribute);
			const $a = $(`<a href>${__("Clear")}</a>`);
			$a.on('click', (e) => {
				e.preventDefault();
				this.dialog.set_value(a.attribute, '');
			});
			field.$wrapper.find('.help-box').append($a);
		});

		this.append_status_area();
		this.dialog.show();

		this.dialog.set_values(JSON.parse(localStorage.getItem(this.get_cache_key())));

		$('.btn-configure').prop('disabled', false);
		this.setup_attribute_selection();
	}

	setup_attribute_selection() {
		this.dialog.$wrapper.find('.modal-dialog').addClass('hidden');
		this.attribute_display_area = $('<div class="attribute-display-area">').prependTo(this.dialog.$wrapper);
		// Bind Events
		this.attribute_display_area.on('click', 'button.attribute-option', e => {
			let target = $(e.target);
			let existing_value = this.dialog.get_value(target.data('fieldname'));
			if (existing_value === target.data('value')) {
				// deselect
				this.dialog.set_value(target.data('fieldname'), '');
				return;
			}
			this.dialog.set_value(target.data('fieldname'), target.data('value'));
		})
		this.render_buttons_for_attribute_display_area();
	}
	render_buttons_for_attribute_display_area() {
		this.attribute_display_area.empty();
		let fields = this.dialog.fields.map(f => f.options ? f : null).filter(f => f);
		const values = this.dialog.get_values();
		fields.forEach(df => {
			this.attribute_display_area.append(`
				<div>
					<div class="label"> ${df.label} : </div>
					<div class="options">
					${df.options.map(option => (`<button ${option.disabled ? 'disabled' : ''} class="btn btn-outline-secondary m-1 attribute-option ${values[df.fieldname] === option.value ? 'active' : ''}" data-fieldname="${df.fieldname}" data-value="${option.value}">${option.label || option.value}</button>`)).join('')}
					</div>
				</div>
				`);
		});
	}

	on_attribute_selection(e) {
		if (e) {
			const changed_fieldname = $(e.target).data('fieldname');
			this.show_range_input_if_applicable(changed_fieldname);
		} else {
			this.show_range_input_for_all_fields();
		}

		const values = this.dialog.get_values();
		if (Object.keys(values).length === 0) {
			this.clear_status();
			localStorage.removeItem(this.get_cache_key());
			return;
		}

		// save state
		localStorage.setItem(this.get_cache_key(), JSON.stringify(values));

		// show
		this.set_loading_status();

		this.get_next_attribute_and_values(values)
			.then(data => {
				const {
					valid_options_for_attributes,
				} = data;

				this.set_item_found_status(data);

				for (let attribute in valid_options_for_attributes) {
					const valid_options = valid_options_for_attributes[attribute];
					const options = this.dialog.get_field(attribute).df.options;
					const new_options = options.map(o => {
						o.disabled = !valid_options.includes(o.value);
						return o;
					});

					this.dialog.set_df_property(attribute, 'options', new_options);
					this.dialog.get_field(attribute).set_options();
				}
				this.render_buttons_for_attribute_display_area();
			});
	}

	show_range_input_for_all_fields() {
		this.dialog.fields.forEach(f => {
			if (!["Section Break", "Coulmn Break"].includes(f.fieldtype)) {
				this.show_range_input_if_applicable(f.fieldname);
			}
		});
	}

	show_range_input_if_applicable(fieldname) {
		const changed_field = this.dialog.get_field(fieldname);
		const changed_value = changed_field.get_value();
		if (changed_value && changed_value.includes(' to ')) {
			// possible range input
			let numbers = changed_value.split(' to ');
			numbers = numbers.map(number => parseFloat(number));

			if (!numbers.some(n => isNaN(n))) {
				numbers.sort((a, b) => a - b);
				if (changed_field.$input_wrapper.find('.range-selector').length) {
					return;
				}
				const parent = $('<div class="range-selector">')
					.insertBefore(changed_field.$input_wrapper.find('.help-box'));
				const control = frappe.ui.form.make_control({
					df: {
						fieldtype: 'Int',
						label: __('Enter value betweeen {0} and {1}', [numbers[0], numbers[1]]),
						change: () => {
							const value = control.get_value();
							if (value < numbers[0] || value > numbers[1]) {
								control.$wrapper.addClass('was-validated');
								control.set_description(
									__('Value must be between {0} and {1}', [numbers[0], numbers[1]]));
								control.$input[0].setCustomValidity('error');
							} else {
								control.$wrapper.removeClass('was-validated');
								control.set_description('');
								control.$input[0].setCustomValidity('');
								this.update_range_values(fieldname, value);
							}
						}
					},
					render_input: true,
					parent
				});
				control.$wrapper.addClass('mt-3');
			}
		}
	}

	update_range_values(attribute, range_value) {
		this.range_values = this.range_values || {};
		this.range_values[attribute] = range_value;
	}

	show_remaining_optional_attributes() {
		// show all attributes if remaining
		// unselected attributes are all optional
		const unselected_attributes = this.dialog.fields.filter(df => {
			const value_selected = this.dialog.get_value(df.fieldname);
			return !value_selected;
		});
		const is_optional_attribute = df => {
			const optional_attributes = this.attribute_data
				.filter(a => a.optional).map(a => a.attribute);
			return optional_attributes.includes(df.fieldname);
		};
		if (unselected_attributes.every(is_optional_attribute)) {
			unselected_attributes.forEach(df => {
				this.dialog.fields_dict[df.fieldname].$wrapper.show();
			});
		}
	}

	set_loading_status() {
		this.dialog.$status_area.html(`
			<div class="alert alert-warning d-flex justify-content-between align-items-center" role="alert">
				${__('Loading...')}
			</div>
		`);
	}

	set_item_found_status(data) {
		const html = this.get_html_for_item_found(data);
		this.dialog.$status_area.html(html);
	}

	clear_status() {
		this.dialog.$status_area.empty();
	}

	get_html_for_item_found({ filtered_items_count, filtered_items, exact_match, product_info }) {
		const one_item = exact_match.length === 1
			? exact_match[0]
			: filtered_items_count === 1
				? filtered_items[0]
				: '';

		const item_add_to_cart = one_item ? `
			<button data-item-code="${one_item}"
				class="btn btn-primary btn-add-to-cart w-100"
				data-action="btn_add_to_cart"
			>
				<span class="mr-2">
					${frappe.utils.icon('assets', 'md')}
				</span>
				${__("Add to Cart")}
			</button>
		` : '';

		const items_found = filtered_items_count === 1 ?
			__('{0} item found.', [filtered_items_count]) :
			__('{0} items found.', [filtered_items_count]);

		/* eslint-disable indent */
		const item_found_status = exact_match.length === 1
			? `<div class="alert alert-success d-flex justify-content-between align-items-center" role="alert">
				<div><div>
					${one_item}
					${product_info && product_info.price && !$.isEmptyObject(product_info.price)
				? '(' + product_info.price.formatted_price_sales_uom + ')'
				: ''
			}
				</div></div>
				<a href data-action="btn_clear_values" data-item-code="${one_item}">
					${__('Clear Values')}
				</a>
			</div>`
			: `<div class="alert alert-warning d-flex justify-content-between align-items-center" role="alert">
					<span>
						${items_found}
					</span>
					<a href data-action="btn_clear_values">
						${__('Clear values')}
					</a>
			</div>`;
		/* eslint-disable indent */

		return `
			${item_found_status}
			${item_add_to_cart}
		`;
	}

	btn_add_to_cart(e) {
		if (frappe.session.user !== 'Guest') {
			localStorage.removeItem(this.get_cache_key());
		}
		const item_code = $(e.currentTarget).data('item-code');
		const additional_notes = Object.keys(this.range_values || {}).map(attribute => {
			return `${attribute}: ${this.range_values[attribute]}`;
		}).join('\n');
		webshop.webshop.shopping_cart.update_cart({
			item_code,
			additional_notes,
			qty: 1
		});
		this.dialog.hide();
	}

	btn_clear_values() {
		this.dialog.fields_list.forEach(f => {
			if (f.df?.options) {
				f.df.options = f.df.options.map(option => {
					option.disabled = false;
					return option;
				});
			}
		});
		this.dialog.clear();
		this.on_attribute_selection();
		this.render_buttons_for_attribute_display_area();
	}

	append_status_area() {
		this.dialog.$wrapper.addClass('item-configurator-dialog');
		this.dialog.$status_area = $('<div class="status-area mt-5">');
		this.dialog.$wrapper.append(this.dialog.$status_area);
		this.dialog.$wrapper.on('click', '[data-action]', (e) => {
			e.preventDefault();
			const $target = $(e.currentTarget);
			const action = $target.data('action');
			const method = this[action];
			method.call(this, e);
		});
	}

	get_next_attribute_and_values(selected_attributes) {
		return this.call('webshop.webshop.variant_selector.utils.get_next_attribute_and_values', {
			item_code: this.item_code,
			selected_attributes
		});
	}

	get_attributes_and_values() {
		return this.call('webshop.webshop.variant_selector.utils.get_attributes_and_values', {
			item_code: this.item_code
		});
	}

	get_cache_key() {
		return `configure:${this.item_code}`;
	}

	call(method, args) {
		// promisified frappe.call
		return new Promise((resolve, reject) => {
			frappe.call(method, args)
				.then(r => resolve(r.message))
				.fail(reject);
		});
	}
}

function set_continue_configuration() {
	const $btn_configure = $('.btn-configure');
	const { itemCode } = $btn_configure.data();

	if (localStorage.getItem(`configure:${itemCode}`)) {
		$btn_configure.text(__('Continue Selection'));
	} else {
		$btn_configure.text(__('Select Variant'));
	}
}

frappe.ready(() => {
	frappe.ui.AttributeDialog = class CustomDialog extends frappe.ui.Dialog {
		// You can pass the container selector in the constructor or just hardcode it
		constructor(opts) {
			// You might want to remove 'modal' from the classes if you don't
			// want the dialog's styling to conflict with its non-popup context.
			if (!opts.container_selector) {
				console.error("CustomDialog requires a container_selector option.");
				// Fallback or throw error
			}

			super(opts);

			// Store the selector
			this.container_selector = opts.container_selector;
		}

		make() {
			// Call the original make method to build the dialog's structure (`this.$wrapper`)
			super.make();

			// 1. Remove standard dialog/modal classes/attributes for in-place rendering
			this.$wrapper.removeClass("modal-dialog-scrollable modal-dialog");
			this.$wrapper.attr("role", "none"); // Remove role=document

			// The default `super.make()` appends `this.$wrapper` to `.modal-content`
			// which is then put into the body. We need to move the *actual content*
			// or the entire wrapper. The safest is to move the top-level wrapper.

			// 2. Remove the wrapper from its default parent (the modal backdrop/container)
			// this.$wrapper.closest('.modal').remove();

			// 3. Append the dialog wrapper to your custom container
			const $container = $(this.container_selector);
			if ($container.length) {
				// Append the content wrapper (which is `this.$wrapper`)
				$container.append(this.$wrapper);
			} else {
				console.error(`Container '${this.container_selector}' not found.`);
			}
			this.$wrapper.find(".modal-header").hide();
		}

		// You might also need to override show and hide to skip modal-specific logic
		show() {
			this.$wrapper.show();
			this.primary_action_fulfilled = false;
			this.is_visible = true;
			return this;
		}

		hide() {
			this.$wrapper.hide();
			this.is_visible = false;
		}
	};
	new ItemConfigure("{{ doc.item_code }}", "{{ doc.web_item_name }}");
});
