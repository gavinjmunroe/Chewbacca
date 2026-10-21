//
//  BirthdayStepView.swift
//  AmberApp
//
//  Created on 2026-03-04.
//

import SwiftUI

struct BirthdayStepView: View {
    @ObservedObject var viewModel: OnboardingViewModel
    @State private var showTimePicker: Bool = false
    @State private var showHoroscope: Bool = false
    @State private var selectedDate: Date = Calendar.current.date(
        from: DateComponents(year: 2000, month: 1, day: 1)
    ) ?? Date()

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: 40)

                Text("When were you born?")
                    .font(.amberTitle)
                    .foregroundColor(.white)
                    .padding(.bottom, 8)

                Text("We'll use this to personalize your experience.")
                    .font(.amberBody)
                    .foregroundColor(.white.opacity(0.6))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 32)

                // Date picker
                DatePicker("Birthday", selection: $selectedDate, in: ...Date(), displayedComponents: .date)
                    .datePickerStyle(.wheel)
                    .labelsHidden()
                    .colorScheme(.dark)
                    .padding(.horizontal, 24)
                    .onChange(of: selectedDate) { newValue in
                        viewModel.birthday = newValue
                        withAnimation(.spring(response: 0.6, dampingFraction: 0.7)) {
                            showHoroscope = true
                        }
                    }

                // Birth time toggle
                VStack(spacing: 12) {
                    Button(action: { withAnimation { showTimePicker.toggle() } }) {
                        HStack {
                            Image(systemName: "clock")
                                .foregroundColor(.amberBlue)
                            Text("Add birth time for a more precise horoscope")
                                .font(.amberCaption)
                                .foregroundColor(.white.opacity(0.6))
                            Spacer()
                            Image(systemName: showTimePicker ? "chevron.up" : "chevron.down")
                                .font(.system(size: 12))
                                .foregroundColor(.white.opacity(0.4))
                        }
                        .padding(14)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(.ultraThinMaterial)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                                )
                        )
                    }
                    .padding(.horizontal, 24)

                    if showTimePicker {
                        DatePicker("Birth time",
                                   selection: Binding(
                                       get: { viewModel.birthdayTime ?? Date() },
                                       set: { viewModel.birthdayTime = $0 }
                                   ),
                                   displayedComponents: .hourAndMinute)
                            .datePickerStyle(.wheel)
                            .labelsHidden()
                            .colorScheme(.dark)
                            .frame(height: 120)
                            .padding(.horizontal, 24)
                            .transition(.opacity.combined(with: .scale(scale: 0.95)))

                        // Birth location
                        TextField("Birth location (optional)", text: $viewModel.birthLocation)
                            .font(.amberBody)
                            .foregroundColor(.white)
                            .padding(14)
                            .background(
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(.ultraThinMaterial)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 12)
                                            .stroke(Color.white.opacity(0.1), lineWidth: 1)
                                    )
                            )
                            .padding(.horizontal, 24)
                    }
                }
                .padding(.top, 16)

                // Horoscope reveal
                if showHoroscope, let sign = viewModel.derivedHoroscope {
                    VStack(spacing: 8) {
                        Text(sign.symbol)
                            .font(.system(size: 48))

                        Text(sign.name)
                            .font(.amberHeadline)
                            .foregroundColor(.white)

                        HStack(spacing: 16) {
                            Label(sign.element, systemImage: elementIcon(sign.element))
                                .font(.amberCaption)
                                .foregroundColor(.white.opacity(0.6))
                            Label(sign.modality, systemImage: "circle.grid.3x3")
                                .font(.amberCaption)
                                .foregroundColor(.white.opacity(0.6))
                        }

                        Text(sign.dateRange)
                            .font(.amberCaption)
                            .foregroundColor(.white.opacity(0.4))
                    }
                    .padding(24)
                    .frame(maxWidth: .infinity)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(.ultraThinMaterial)
                            .overlay(
                                RoundedRectangle(cornerRadius: 14)
                                    .stroke(Color.amberBlue.opacity(0.3), lineWidth: 1)
                            )
                    )
                    .padding(.horizontal, 24)
                    .padding(.top, 24)
                    .transition(.scale(scale: 0.8).combined(with: .opacity))
                }

                // Error
                if let error = viewModel.error {
                    Text(error)
                        .font(.amberCaption)
                        .foregroundColor(.red)
                        .padding(.top, 8)
                }

                Spacer().frame(height: 32)

                // Continue button
                Button(action: {
                    viewModel.birthday = selectedDate
                    viewModel.submitCurrentStep()
                }) {
                    Text("Continue")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 54)
                        .background(
                            RoundedRectangle(cornerRadius: 14)
                                .fill(Color.amberBlue)
                        )
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 40)
            }
        }
        .scrollIndicators(.hidden)
    }

    private func elementIcon(_ element: String) -> String {
        switch element {
        case "Fire": return "flame"
        case "Earth": return "leaf"
        case "Air": return "wind"
        case "Water": return "drop"
        default: return "sparkle"
        }
    }
}
