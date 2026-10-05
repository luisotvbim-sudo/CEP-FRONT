using System.Windows;

namespace CepHoras.Desktop;

public partial class ClosePasswordDialog : Window
{
    public ClosePasswordDialog()
    {
        InitializeComponent();
        Loaded += (_, _) => PasswordInput.Focus();
        Closed += (_, _) => PasswordInput.Clear();
    }

    private void Confirm_Click(object sender, RoutedEventArgs e)
    {
        if (DailyClosePassword.IsValid(PasswordInput.Password, DateTime.Now))
        {
            PasswordInput.Clear();
            DialogResult = true;
            return;
        }

        PasswordInput.Clear();
        PasswordInput.Focus();
    }
}
